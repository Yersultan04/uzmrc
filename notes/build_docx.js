const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  ImageRun, AlignmentType, HeadingLevel, LevelFormat, BorderStyle,
  WidthType, ShadingType, PageNumber, Header, Footer,
} = require("docx");

const SS = path.join(__dirname, "screenshots");
const CONTENT_W = 9360; // US Letter, 1" margins
const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const HEAD_FILL = "0F6E56"; // brand green
const cellMargins = { top: 60, bottom: 60, left: 120, right: 120 };

function h1(t) { return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] }); }
function h2(t) { return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] }); }
function p(runs) { return new Paragraph({ children: Array.isArray(runs) ? runs : [new TextRun(runs)], spacing: { after: 120 } }); }
function bullet(text) { return new Paragraph({ numbering: { reference: "b", level: 0 }, children: parseInline(text), spacing: { after: 40 } }); }

// minimal **bold** parser
function parseInline(s) {
  const out = []; const re = /\*\*(.+?)\*\*/g; let last = 0, m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push(new TextRun(s.slice(last, m.index)));
    out.push(new TextRun({ text: m[1], bold: true }));
    last = re.lastIndex;
  }
  if (last < s.length) out.push(new TextRun(s.slice(last)));
  return out.length ? out : [new TextRun(s)];
}

function headCell(t, w) {
  return new TableCell({ borders, width: { size: w, type: WidthType.DXA }, margins: cellMargins,
    shading: { fill: HEAD_FILL, type: ShadingType.CLEAR },
    children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, color: "FFFFFF", size: 20 })] })] });
}
function cell(content, w, opts = {}) {
  const runs = typeof content === "string" ? parseInline(content) : content;
  return new TableCell({ borders, width: { size: w, type: WidthType.DXA }, margins: cellMargins,
    shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
    children: [new Paragraph({ children: runs.map((r) => r), alignment: opts.align })] });
}
function table(cols, headers, rows) {
  const trows = [new TableRow({ tableHeader: true, children: headers.map((t, i) => headCell(t, cols[i])) })];
  for (const r of rows) {
    trows.push(new TableRow({ children: r.map((c, i) => {
      const status = String(c).startsWith("✅") || String(c).startsWith("⚠");
      return cell(String(c), cols[i], status ? { fill: String(c).startsWith("✅") ? "E7F3EE" : "FDF3E2" } : {});
    }) }));
  }
  return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: cols, rows: trows });
}

function imageBlock(file, caption, wpx) {
  const dims = { "uzmrc-aiconfig-editor.png": [1031, 1387], "verify-1-privet.png": [1036, 703],
    "verify-2-doc-answer.png": [1036, 703], "verify-classification-filtered.png": [1036, 703] }[file];
  const ratio = dims[1] / dims[0];
  const w = wpx, hgt = Math.round(wpx * ratio);
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 40 },
      children: [new ImageRun({ type: "png", data: fs.readFileSync(path.join(SS, file)),
        transformation: { width: w, height: hgt },
        altText: { title: caption, description: caption, name: file } })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 },
      children: [new TextRun({ text: caption, italics: true, size: 18, color: "666666" })] }),
  ];
}

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 21 } } },
    paragraphStyles: [
      { id: "Title", name: "Title", basedOn: "Normal", next: "Normal",
        run: { size: 40, bold: true, color: "0F6E56", font: "Arial" }, paragraph: { spacing: { after: 80 } } },
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, color: "0F6E56", font: "Arial" },
        paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 180, after: 100 }, outlineLevel: 1 } },
    ],
  },
  numbering: { config: [{ reference: "b", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•",
    alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 460, hanging: 260 } } } }] }] },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "UzMRC — Изменения 2026-06-22 · стр. ", size: 16, color: "999999" }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "999999" })] })] }) },
    children: [
      new Paragraph({ style: "Title", children: [new TextRun("UzMRC — Отчёт об изменениях")] }),
      new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: "Дата: 22 июня 2026 · Прод: https://89.167.15.225.sslip.io · RAG: 86e90882 (499 файлов) · Репо: Yersultan04/uzmrc", size: 18, color: "555555" })] }),
      new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "0F6E56", space: 1 } }, spacing: { after: 160 }, children: [] }),

      h1("1. Чек-лист задач и выполнение"),
      p([new TextRun({ text: "Итого: 11 из 12 задач выполнены полностью; OCR сканов сознательно отложен пользователем (дорого, не блокирует работу).", bold: true })]),
      table([520, 5200, 1200, 2440],
        ["#", "Задача", "Статус", "Решение"],
        [
          ["1", "Бот эскалировал на «привет/кто ты» (уверенность 0%)", "✅", "Класс smalltalk → персона-ответ"],
          ["2", "Нормальная модель (не дешёвая)", "✅", "gpt-4o"],
          ["3", "Паттерны из админки Эльзы", "✅", "Персона + routing + AIConfig"],
          ["4", "Грейсфул «нет в документах»", "✅", "FINAL вместо эскалации"],
          ["5", "Разделение языков (без code-switch)", "✅", "LANGUAGE RULES"],
          ["6", "Дефолтный офиц-деловой тон", "✅", "Прод-дефолт"],
          ["7", "Редактируемая персона через админку", "✅", "Вкладка Настройки"],
          ["8", "Полный AI Config (что избегать/нет)", "✅", "Тон/Do/Don't/Этика/Языки/Запреты"],
          ["9", "Проверка через Playwright", "✅", "E2E на проде"],
          ["10", "Ускорение («долго думает»)", "✅", "80с → 11–15с"],
          ["11", "Грязные файлы: найти и почистить", "⚠ Частично", "Отчёт готов; OCR отложен"],
          ["12", "Классификация документов", "✅", "499/499 за 61с"],
        ]),

      h1("2. Что нового для пользователя"),
      h2("База → Настройки → «Поведение ассистента»"),
      bullet("**Тон и характер** — как общается ассистент."),
      bullet("**Что ДОЛЖЕН / НЕ должен делать** — списки правил."),
      bullet("**Этика и безопасность** — правдивость, ссылки на источник."),
      bullet("**Предпочитаемые языки** — ISO-коды (ru, uz, en)."),
      bullet("**Запрещённые темы** — ключевые слова → вежливый отказ без поиска (вводить основу слова: «политик» ловит «политика/политику») + своё сообщение отказа."),
      bullet("Применяется сразу, без переразвёртывания. Пусто = стандартное поведение."),
      h2("База → Файлы"),
      bullet("У каждого файла — **бейдж типа**; вверху **фильтр по типу** и кнопка **«Классифицировать»**."),
      bullet("Типы: Нормативные · Отчёты · Аналитика рынка · Новости/пресс · Эмиссия/инвесторам · Сертификаты · Бизнес-планы · О компании · Прочее."),

      h1("3. Скриншоты (живой прод)"),
      ...imageBlock("verify-1-privet.png", "Приветствие → персона UzMRC (готово, без эскалации)", 540),
      ...imageBlock("verify-2-doc-answer.png", "Документный вопрос → ответ с цитатами [1][2], офиц-тон", 540),
      ...imageBlock("uzmrc-aiconfig-editor.png", "Редактор «Поведение ассистента» (Тон · Do/Don't · Этика · Языки · Запреты)", 430),
      ...imageBlock("verify-classification-filtered.png", "Файлы: бейджи типов + фильтр (Сертификаты → 5 из 499)", 540),

      h1("4. Технические детали"),
      h2("Маршрутизация моделей (per-RAG, rags.settings.models)"),
      bullet("chat/финал: **openai/gpt-4o** (OpenRouter) · rerank: **gpt-oss-120b** (дёшево, by design) · vision: qwen3-vl."),
      bullet("**Почему реранк дешёвый:** реранк = оценка релевантности и пересортировка чанков, а не генерация. Дешёвая крепкая модель ранжирует не хуже дорогой; качество ответа даёт chat-модель (gpt-4o). Инструмент rerank_pool опционален и при сбое возвращает исходный порядок. Для «настоящего» реранка есть Voyage rerank-2.5 (модуль сравнения)."),
      bullet("Гибрид (AGENT_STEP_MODEL, по умолчанию OFF) — быстрые шаги + качественный финал; включать только для медленных reasoning-моделей (gpt-5.4)."),
      bullet("Шаги идут через OpenRouter (не Cerebras free-tier — он давал 429 + 59с backoff)."),
      h2("Ключевые файлы"),
      bullet("agent/router.py (smalltalk), agent/prompts.py (персона, LANGUAGE RULES, build_admin_instructions, check_restricted_topics), agent/loop.py (short-circuit, гибрид), api/rags.py (PATCH ai_config), api/files.py (classify), ingestion/classify.py, models.py (files.doc_type, миграция 0010)."),

      h1("5. Деплой и откат"),
      bullet("Сервер: Hetzner 89.167.15.225, репо /opt/uzmrc/rag-cms (не git)."),
      bullet("Деплой: scp файлов + docker compose ... up -d --build <svc> (бэкенд сам делает alembic upgrade head)."),
      bullet("Откат: серверные бэкапы в .rollback/<TS>/, дамп БД в backups/."),
      bullet("Коммиты сессии: becafa5 → ab2b693, запушены в main."),

      h1("6. Грязные файлы (отчёт)"),
      p("20 пустых сканов без текстового слоя (NAPS2): квартальные Nch/Q*UZ20YY, аудиты (2020audit, ZaminOilAudit, Odil-Audit-KPI), certificate-iso, приказы _ksiyalari…, Qaror91221, uzA.Ahborreyting. Сейчас помечены типом, но пустые в индексе."),
      p([new TextRun({ text: "Чистка = OCR (vision-модель, ~20–40 мин) — запускать отдельно при необходимости (рекомендация: только отчёты/приказы, пропустить тяжёлые аудиты).", italics: true })]),
    ],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  const out = path.join(__dirname, "UzMRC-Changes-2026-06-22.docx");
  fs.writeFileSync(out, buf);
  console.log("written", out, buf.length, "bytes");
});
