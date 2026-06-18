import { useEffect, useState } from 'react';
import { api, type RagStats, type Rag } from '../api';

/** Публичная инфо-панель «О системе / База знаний».
 *  Тянет живые цифры корпуса из GET /rags/:id/stats для готового RAG. */
export default function AboutSystem() {
  const [stats, setStats] = useState<RagStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rags: Rag[] = await api.listRags();
        // Предпочитаем готовый RAG; иначе первый доступный.
        const target =
          rags.find((r) => r.status === 'ready') ?? rags[0] ?? null;
        if (!target) {
          if (alive) setError('Нет доступных баз знаний.');
          return;
        }
        const s = await api.getRagStats(target.id);
        if (alive) setStats(s);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="col gap-12" style={{ maxWidth: 980, margin: '0 auto' }}>
      <div className="hero-block">
        <h1 style={{ margin: '0 0 6px' }}>UzMRC — ИИ-ассистент по нормативным документам</h1>
        <p className="muted" style={{ margin: 0 }}>
          Система отвечает на вопросы по внутренним нормативным документам со ссылкой на источник
          (файл, страницу и точную цитату) и сравнивает новые приказы с действующими нормами.
          MVP для демонстрации.
        </p>
      </div>

      {/* Живые цифры базы знаний */}
      <div className="card">
        <div className="card-header">
          <h3>База знаний — текущий корпус</h3>
        </div>
        <div className="card-body">
          {loading && <p className="muted">Загрузка статистики…</p>}
          {error && <p className="badge danger">Ошибка: {error}</p>}
          {stats && (
            <>
              <div className="grid cols-3">
                <Kpi label="Документов" value={stats.documents} hint="уникальных файлов" />
                <Kpi label="Фрагментов (чанков)" value={stats.chunks.toLocaleString('ru-RU')} hint="индексировано" />
                <Kpi label="Чанков на документ" value={stats.avg_chunks_per_doc} hint="в среднем" />
              </div>
              <div className="grid cols-3" style={{ marginTop: 16 }}>
                <Kpi label="Модель эмбеддингов" value={stats.embed_model} hint={`${stats.embed_dim}-мерные векторы`} />
                <Kpi label="Токенов в индексе" value={stats.total_tokens.toLocaleString('ru-RU')} hint="суммарно по чанкам" />
                <Kpi
                  label="Статус базы"
                  value={stats.status === 'ready' ? 'Готова' : stats.status}
                  hint={stats.rag_name}
                />
              </div>
              <p className="muted" style={{ marginTop: 16, fontSize: 13 }}>
                Источник корпуса — нормативные и аналитические документы УзКРИ (uzmrc.uz):
                ≈35 нормативных актов + ≈12 аналитических обзоров (≈595 страниц в исходных PDF).
                Это демо-набор, а не полная база.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Что умеет система */}
      <div className="grid cols-2">
        <div className="card">
          <div className="card-header"><h3>1. Чат по документам</h3></div>
          <div className="card-body">
            <ul className="feature-list">
              <li>Ответ на вопрос на русском или узбекском языке.</li>
              <li>Ссылка на источник: файл, страница, точная цитата.</li>
              <li>Кросс-языковой поиск: вопрос на русском находит нормы и в русских, и в узбекских документах.</li>
              <li>Если ответа в базе нет — система не выдумывает цитаты.</li>
            </ul>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>2. Сравнение документов</h3></div>
          <div className="card-body">
            <ul className="feature-list">
              <li>Новый приказ разбивается на пункты и сверяется с базой.</li>
              <li>Типы находок: <b>противоречие</b>, <b>пробел</b>, <b>дополнение</b>, <b>дубль</b>.</li>
              <li>По каждой находке — обоснование, цитата нормы и рекомендация.</li>
              <li>Отчёт фильтруется по типу и выгружается в .md или PDF.</li>
              <li>Фоновый прогон с прогресс-баром (~20–25с на 10 пунктов).</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Что входит / не входит в MVP */}
      <div className="grid cols-2">
        <div className="card">
          <div className="card-header"><h3>Входит в MVP</h3></div>
          <div className="card-body">
            <ul className="feature-list">
              <li>Чат по загруженной базе со ссылками на источник.</li>
              <li>Сравнение нового документа с нормами.</li>
              <li>Кросс-языковой поиск (ru ↔ uz).</li>
              <li>Экспорт отчёта (.md / PDF).</li>
            </ul>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>Не входит в MVP / ограничения</h3></div>
          <div className="card-body">
            <ul className="feature-list">
              <li>Анализ портфеля, маскирование ПДн, генерация презентаций, парсинг рынка/OLX — вне MVP.</li>
              <li>До 120 пунктов за один прогон сравнения; длинные документы лучше делить.</li>
              <li>Загрузка новых документов требует интернета и платных ключей эмбеддингов Voyage.</li>
              <li>Поиск и сравнение по уже загруженной базе работают быстро.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
