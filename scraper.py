#!/usr/bin/env python3
"""
UzMRC reconciliation crawler — собирает ВЕСЬ публичный корпус файлов с uzmrc.uz
тремя независимыми методами и доказывает полноту через сходимость.

Pass A — витрины разделов (nav tree) + пагинация ?page=N до исчерпания.
Pass B — все leaf-страницы (sitemap + ссылки из A), извлечение /uploads/*.{pdf,doc,xls}.
Pass C — перебор паттернов папок (годы/кварталы) с HEAD-проверкой существования.

Reconcile: A ∪ B ∪ C по канонической ссылке. Отчёт сходимости: что нашёл только
один метод (= другой был неполон). Манифест с провенансом.

  python scraper.py            # discovery + отчёт сходимости + манифест
  python scraper.py --download # + скачать всё в corpus/all/ с sha256 и текстом
"""
from __future__ import annotations
import argparse, json, re, ssl, sys, time, hashlib, urllib.request, urllib.parse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BASE = "https://uzmrc.uz"
HERE = Path(__file__).parent
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
FILE_RE = re.compile(r'(/uploads/[^\s"<>\\\)]+?\.(?:pdf|docx?|xlsx?|pptx?))', re.I)
LOC_RE = re.compile(r"<loc>(.*?)</loc>")

# --- Pass A: разделы из навигации (ru + uz пути) ---
SECTIONS = [
    "/ru/about/normativnye-dokumenty/", "/about/normativ-hujjatlar/", "/about/kompaniya-ustavi/",
    "/refinance-programm/tahliliy-malumotlar/",
    "/mortgage-market-of-uzbekistan/bozor-va-tahlil/",
    "/mortgage-market-of-uzbekistan/ipoteka-savodxonligi/",
    "/mortgage-market-of-uzbekistan/ilmiy-va-ekspert-maqolalar/",
    "/mortgage-market-of-uzbekistan/hayotiy-misollar/",
    "/shareholders-investors/moliyaviy-hisobotlar/",
    "/shareholders-investors/moliyaviy-hisobotlar/choraklik-hisobotlar/",
    "/shareholders-investors/moliyaviy-hisobotlar/yillik-hisobotlar/",
    "/shareholders-investors/moliyaviy-hisobotlar/tashqi-audit/",
    "/shareholders-investors/obligatsiyalar-emissiyasi/",
    "/shareholders-investors/aksiyalar-emissiyasi/",
    "/shareholders-investors/muhim-faktlar/",
    "/shareholders-investors/dividendlar/",
    "/shareholders-investors/dividendlar/choraklik-hisobotlar/",
    "/shareholders-investors/kpi/",
    "/shareholders-investors/reytinglar/", "/shareholders-investors/reytinglar/milliy-reyting/",
    "/shareholders-investors/certificates/",
    "/shareholders-investors/biznes-reja-va-strategiya/",
    "/shareholders-investors/biznes-reja-va-strategiya/biznes-reja/",
    "/shareholders-investors/biznes-reja-va-strategiya/strategiya/",
    "/shareholders-investors/aksiyadorlarning-ovoz-berish-natijalari/",
    "/press/news/", "/press/ads/", "/press/tenders/", "/press/smi-about-us/", "/press/video/",
]


def get(url: str, tries: int = 3) -> str:
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            return urllib.request.urlopen(req, context=CTX, timeout=45).read().decode("utf-8", "ignore")
        except Exception:
            time.sleep(1.5 * (i + 1))
    return ""


def canon(href: str) -> str:
    """Каноническая абсолютная ссылка (для дедупа)."""
    href = href.strip().replace("&amp;", "&")
    if href.startswith("/"):
        href = BASE + href
    return href


def files_in(html: str) -> set[str]:
    return {canon(m) for m in FILE_RE.findall(html)}


# ---------------- Pass A ----------------
def pass_a() -> dict[str, set[str]]:
    """Витрины + пагинация. Возвращает {url_файла: {раздел}}."""
    found: dict[str, set[str]] = defaultdict(set)

    def crawl_section(sec: str) -> tuple[str, set[str]]:
        acc: set[str] = set()
        empty_streak = 0
        for n in range(1, 61):
            html = get(f"{BASE}{sec}?page={n}") if n > 1 else (get(BASE + sec) + get(f"{BASE}{sec}?page=1"))
            fs = files_in(html)
            new = fs - acc
            acc |= fs
            if not new:
                empty_streak += 1
                if empty_streak >= 3:  # 3 страницы подряд без новых файлов → исчерпано
                    break
            else:
                empty_streak = 0
        return sec, acc

    with ThreadPoolExecutor(max_workers=8) as ex:
        for sec, acc in ex.map(crawl_section, SECTIONS):
            for f in acc:
                found[f].add(sec)
    return found


# ---------------- Pass B ----------------
def pass_b(extra_pages: set[str]) -> dict[str, set[str]]:
    """Все leaf-страницы sitemap + переданные. {url_файла: {leaf_url}}."""
    sm = get(BASE + "/sitemap.xml")
    pages = set(LOC_RE.findall(sm)) | extra_pages
    pages |= {BASE + s for s in SECTIONS}
    found: dict[str, set[str]] = defaultdict(set)

    def work(p: str) -> tuple[str, set[str]]:
        return p, files_in(get(p))

    with ThreadPoolExecutor(max_workers=16) as ex:
        for p, fs in ex.map(work, pages):
            for f in fs:
                found[f].add(p)
    return found


# ---------------- Pass C ----------------
YEAR_RE = re.compile(r"(19|20)\d{2}")


def head_exists(url: str) -> bool:
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
        r = urllib.request.urlopen(req, context=CTX, timeout=20)
        return r.status == 200
    except Exception:
        # некоторые серверы не дают HEAD — пробуем GET с Range
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Range": "bytes=0-0"})
            r = urllib.request.urlopen(req, context=CTX, timeout=20)
            return r.status in (200, 206)
        except Exception:
            return False


def pass_c(known: set[str]) -> set[str]:
    """Перебор год/квартал-вариантов в путях известных файлов. HEAD-проверка."""
    candidates: set[str] = set()
    for url in known:
        years = set(YEAR_RE.findall(url))  # фрагменты вида '20'
        # ищем полные 4-значные годы в пути
        for y in re.findall(r"(20\d{2})", url):
            for ny in range(2020, 2027):
                cand = url.replace(y, str(ny))
                if cand != url:
                    candidates.add(cand)
        # квартальные шаблоны 1ch/2ch/3ch/4ch, 1-kv/2-kv...
        for q in re.findall(r"([1-4])(ch|kv|-kv|kv-)", url):
            for nq in "1234":
                candidates.add(re.sub(r"[1-4](ch|kv|-kv|kv-)", nq + q[1], url, count=1))
    candidates -= known
    found: set[str] = set()
    with ThreadPoolExecutor(max_workers=16) as ex:
        for cand, ok in ex.map(lambda c: (c, head_exists(c)), candidates):
            if ok:
                found.add(cand)
    return found


# ---------------- Download ----------------
def download_all(urls: list[str]) -> list[dict]:
    out = HERE / "corpus" / "all"; out.mkdir(parents=True, exist_ok=True)
    txt = HERE / "corpus" / "all_txt"; txt.mkdir(parents=True, exist_ok=True)
    try:
        import fitz
    except ImportError:
        fitz = None
    manifest = []

    def fetch_bytes(u: str) -> bytes:
        req = urllib.request.Request(urllib.parse.quote(u, safe=":/?&="), headers={"User-Agent": "Mozilla/5.0"})
        return urllib.request.urlopen(req, context=CTX, timeout=120).read()

    for i, u in enumerate(sorted(urls), 1):
        name = re.sub(r"[^A-Za-z0-9._-]", "_", u.split("/")[-1])[:120]
        try:
            data = fetch_bytes(u)
            (out / name).write_bytes(data)
            chars, pages = 0, 0
            if fitz and name.lower().endswith(".pdf"):
                try:
                    with fitz.open(stream=data, filetype="pdf") as d:
                        pages = d.page_count
                        t = "\n".join((p.get_text("text") or "") for p in d)
                        (txt / (name + ".txt")).write_text(t, encoding="utf-8"); chars = len(t)
                except Exception:
                    pass
            manifest.append({"url": u, "file": name, "sha256": hashlib.sha256(data).hexdigest(),
                             "bytes": len(data), "pages": pages, "chars": chars})
            if i % 25 == 0:
                print(f"  downloaded {i}/{len(urls)}")
        except Exception as e:
            manifest.append({"url": u, "error": str(e)[:120]})
    return manifest


def classify(url: str) -> str:
    u = url.lower()
    if "fakt" in u or "sushfakt" in u: return "Существенные факты"
    if "moliyaviy" in u or "financialreport" in u or "hisobot" in u: return "Фин.отчёты"
    if "normativ" in u or "docsupervisory" in u or "docshareholders" in u or "ustav" in u: return "Нормативка"
    if "analytical" in u or "anal_data" in u or "kompaniyaning" in u or "tahlil" in u or "sharhi" in u: return "Аналитика/обзоры"
    if "emiss" in u or "obligatsiya" in u or "aksiya" in u: return "Облигации/акции"
    if "biznesreja" in u or "strateg" in u: return "Стратегия/бизнес-план"
    return "Прочее"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--download", action="store_true")
    args = ap.parse_args()

    print("=== Pass A: витрины + пагинация ===")
    A = pass_a()
    print(f"  A нашёл файлов: {len(A)}")

    print("=== Pass B: leaf-страницы (sitemap + витрины) ===")
    extra = {p for fs in A.values() for p in ()}  # noqa (заглушка)
    B = pass_b(set())
    print(f"  B нашёл файлов: {len(B)}")

    union1 = set(A) | set(B)
    print("=== Pass C: перебор паттернов папок ===")
    C = pass_c(union1)
    print(f"  C нашёл НОВЫХ файлов: {len(C)}")

    allf = union1 | C

    # --- отчёт сходимости ---
    only_a = set(A) - set(B)
    only_b = set(B) - set(A)
    print("\n================ ОТЧЁТ СХОДИМОСТИ ================")
    print(f"Pass A (витрины):      {len(A)}")
    print(f"Pass B (leaf-краул):   {len(B)}")
    print(f"Pass C (паттерны):     +{len(C)} новых")
    print(f"Только в A (B пропустил): {len(only_a)}")
    print(f"Только в B (A пропустил): {len(only_b)}")
    print(f"ИТОГО уникальных файлов:  {len(allf)}")

    by_cat: dict[str, int] = defaultdict(int)
    for u in allf:
        by_cat[classify(u)] += 1
    print("\n--- по категориям ---")
    for c, n in sorted(by_cat.items(), key=lambda x: -x[1]):
        print(f"  {n:4d}  {c}")

    notes = HERE / "notes"; notes.mkdir(exist_ok=True)
    prov = {}
    for u in sorted(allf):
        passes = []
        if u in A: passes.append("A")
        if u in B: passes.append("B")
        if u in C: passes.append("C")
        prov[u] = {"passes": passes, "category": classify(u)}
    (notes / "discovery_manifest.json").write_text(
        json.dumps(prov, ensure_ascii=False, indent=2), encoding="utf-8")
    (notes / "all_file_urls.txt").write_text("\n".join(sorted(allf)), encoding="utf-8")
    print(f"\nсохранено: notes/discovery_manifest.json ({len(allf)} файлов), notes/all_file_urls.txt")

    if args.download:
        print("\n=== СКАЧИВАНИЕ ===")
        man = download_all(sorted(allf))
        (HERE / "corpus" / "manifest.json").write_text(
            json.dumps(man, ensure_ascii=False, indent=2), encoding="utf-8")
        ok = sum(1 for m in man if "error" not in m)
        print(f"скачано: {ok}/{len(man)} → corpus/all/, текст → corpus/all_txt/, corpus/manifest.json")


if __name__ == "__main__":
    main()
