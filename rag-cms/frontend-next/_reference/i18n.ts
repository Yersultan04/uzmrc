import { useChatStore, type Lang } from "./store";

export const translations = {
  uz: {
    // Navbar
    admin: "Admin",
    signOut: "Chiqish",

    // Home hero
    heroGreeting: "Xush kelibsiz",
    heroTitle: "Bank AI Platformasi",
    heroSubtitle: "Bank operatsiyalari uchun aqlli yordamchi",

    // Tabs
    tabAgents: "AI Agentlar",
    tabDocs: "Qo'llanma",

    // Agents tab
    agentsSubtitle: "Suhbat boshlash yoki davom ettirish uchun agentni tanlang",
    chats: "suhbat",
    chatSingle: "suhbat",
    ctaContinue: "Davom ettiring yoki yangi boshlang",
    ctaStart: "Suhbat boshlang",

    // HR Agent
    hrCapabilities: [
      "HR siyosati va tartib-qoidalar",
      "Mehnat shartnomalari",
      "Ta'til va davomlilik",
      "Imtiyozlar va ish haqi",
      "Intizomiy tartiblar",
      "Onboarding ko'rsatmalari",
    ],

    // Front Office Agent
    foCapabilities: [
      "Kredit mahsulotlari va stavkalar",
      "Hisob turlari va xususiyatlari",
      "Mijozlarga xizmat ko'rsatish",
      "Mahsulot vakolatxonasi mezonlari",
      "Tarif va to'lovlar tuzilishi",
      "Tartibga solish ma'lumotlari",
    ],

    // Cashier Agent
    cashierCapabilities: [
      "Valyuta almashinuvi qoidalari",
      "AML/KYC talablari",
      "Kassa operatsiyalari",
      "Hujjatlar va limitlar",
      "Bilimlarni tekshirish testi",
    ],

    moreTopics: "ta mavzu ko'proq",

    // Docs — overview
    docsWhat: "Bank AI Platformasi nima?",
    docsWhatBody:
      "Bank AI Platformasi — bank xodimlari uchun maxfiy, mahalliy (on-premises) AI yordamchisi. U ixtisoslashtirilgan bilim bazasiga ulanib, HR siyosati va mijozlarga yo'naltirilgan mahsulotlar haqida tez va aniq javoblar beradi.",

    // Docs — steps
    docsStart: "Boshlash",
    docsSteps: [
      { title: "Agentni tanlang", desc: "HR savollari uchun HR Agent, mahsulot savollari uchun Frontoffice Agentni tanlang." },
      { title: "Savol bering", desc: "Oddiy tilda yozing. Agent bilim bazasini qidiradi va manba ko'rsatkichlari bilan javob beradi." },
      { title: "Manbalarni ko'ring", desc: "Har bir javobda hujjat havolalari bor. Asl hujjatni ko'rish uchun manba belgisini bosing." },
      { title: "Suhbatni davom ettiring", desc: "Bir xil threadda qo'shimcha savollar bering — agent kontekstni eslaydi." },
    ],

    // Docs — tips (first "be specific" tip removed)
    docsTips: "Eng yaxshi natijalar uchun maslahatlar",
    docsTipsList: [
      "Bir vaqtning o'zida bitta savol bering — aniqroq javob olasiz.",
      "Javobni tasdiqlash uchun manba hujjatlarini ko'rib chiqing.",
      "Keyingi savollar uchun bir xil threaddan foydalaning — agent kontekstni eslaydi.",
    ],

    // Docs — icons guide
    docsIconsTitle: "Chat interfeysidagi ikonkalar",
    docsIconsAiLabel: "AI javoblarida (hover qilinganda ko'rinadi)",
    docsIconsUserLabel: "Sizning xabarlaringizda",
    docsIconsInputLabel: "Xabar yozish maydoni",
    docsIconsOtherLabel: "Qo'shimcha",
    docsIcons: [
      {
        group: "ai",
        icon: "ThumbsUp",
        name: "Yaxshi javob",
        desc: "AI javobini foydali deb baholaysiz. Bosgach rangi yashilga o'zgaradi va qayta bosib bo'lmaydi.",
      },
      {
        group: "ai",
        icon: "ThumbsDown",
        name: "Yomon javob",
        desc: "AI javobini noto'g'ri yoki yetarli emas deb belgilaysiz. Baholash bir marta beriladi.",
      },
      {
        group: "ai",
        icon: "RotateCcw",
        name: "Qayta yaratish",
        desc: "Faqat so'nggi AI javobida chiqadi. Bosib AI ni javobni qaytadan generatsiya qilishga majburlaysiz.",
      },
      {
        group: "ai",
        icon: "Copy",
        name: "Nusxalash",
        desc: "AI javobini qurilma buferiga nusxalaydi. Nusxalanganidan keyin ✓ belgisiga aylanib, bir soniyadan so'ng qaytadi.",
      },
      {
        group: "user",
        icon: "Pencil",
        name: "Xabarni tahrirlash",
        desc: "Faqat o'zingizning xabarlaringizda, hover qilinganda chap tomonda chiqadi. Yuborganingizni o'zgartirib qayta yuborasiz.",
      },
      {
        group: "input",
        icon: "Send",
        name: "Yuborish",
        desc: "Xabaringizni agentga yuboradi. Xuddi shu narsa klaviaturada Enter tugmasini bosish bilan ham amalga oshadi.",
      },
      {
        group: "input",
        icon: "Square",
        name: "To'xtatish",
        desc: "Agent javob yaratayotganda qizil rangda paydo bo'ladi. Bosib generatsiyani istalgan vaqtda to'xtatish mumkin.",
      },
      {
        group: "other",
        icon: "ChevronDown",
        name: "Pastga o'tish",
        desc: "Suhbatda yuqoriga chiqib ketganda chiqadi. Bosib eng so'nggi xabarlar oldiga qaytasiz.",
      },
    ],

    // Docs — security & limits
    docsSecurity: "Xavfsizlik va maxfiylik",
    docsSecurityBody:
      "Barcha suhbatlar bank ichki infratuzilmasida qayta ishlanadi. Ma'lumotlar ichki tarmoqdan tashqariga chiqmaydi. Muhim operatsiyalar bajarilishidan oldin odam tasdiqlashini talab qiladi.",

    docsLimits: "Muhim cheklovlar",
    docsLimitsBody:
      "Agentlar faqat bank ichki bilim bazasidan javob beradi — umumiy bilim yoki o'qitish ma'lumotlaridan foydalanmaydi. Agar ma'lumot topilmasa, agent bu haqda aniq aytadi.",

    // Draft chat
    draftPlaceholder: "Xabar yozing… (Enter — yuborish, Shift+Enter — yangi qator)",
    draftReadyLabel: "yozishga tayyor",

    // Chat window
    backLabel: "Orqaga",
    homeLabel: "Bosh sahifa",
    activeLabel: "Faol",
    thinkingLabel: "o'ylayapti...",
    workingLabel: "ishlamoqda...",

    // Cashier test
    cashierTakeTest: "Test topshirish",
    cashierGenerating: "Savollar tayyorlanmoqda…",
    cashierTimeLeft: "Qolgan vaqt",
    cashierSubmit: "Testni topshirish",
    cashierPassed: "Muvaffaqiyatli o'tdingiz!",
    cashierFailed: "Afsuski, o'ta olmadingiz.",
    cashierTryAgain: "Qayta urinish",
    cashierYourScore: "Sizning natijangiz",
    cashierRetriesLeft: "Urinishlar qoldi",
    cashierQuestion: "Savol",
    cashierOf: "dan",
    cashierExpired: "Test vaqti tugadi.",
    cashierClose: "Yopish",
  },

  ru: {
    admin: "Админ",
    signOut: "Выйти",

    heroGreeting: "Добро пожаловать",
    heroTitle: "AI Платформа Банка",
    heroSubtitle: "Интеллектуальный ассистент для банковских операций",

    tabAgents: "AI Агенты",
    tabDocs: "Руководство",

    agentsSubtitle: "Выберите агента для начала или продолжения разговора",
    chats: "диалогов",
    chatSingle: "диалог",
    ctaContinue: "Продолжить или начать новый",
    ctaStart: "Начать разговор",

    hrCapabilities: [
      "HR политика и процедуры",
      "Трудовые договоры",
      "Отпуск и посещаемость",
      "Льготы и компенсации",
      "Дисциплинарные процедуры",
      "Руководство по адаптации",
    ],

    foCapabilities: [
      "Кредитные продукты и ставки",
      "Типы счетов и функции",
      "Процедуры обслуживания клиентов",
      "Критерии приемлемости продуктов",
      "Структура комиссий и сборов",
      "Регуляторная информация",
    ],

    cashierCapabilities: [
      "Правила обмена валюты",
      "Требования AML/KYC",
      "Кассовые операции",
      "Документы и лимиты",
      "Тест для проверки знаний",
    ],

    moreTopics: "тем ещё",

    docsWhat: "Что такое AI Платформа Банка?",
    docsWhatBody:
      "AI Платформа Банка — безопасный локальный ИИ-ассистент для сотрудников банка. Он подключается к специализированным базам знаний и даёт быстрые точные ответы по HR-политике и клиентским продуктам.",

    docsStart: "Начало работы",
    docsSteps: [
      { title: "Выберите агента", desc: "HR Агент — для кадровых вопросов, Фронт-офис Агент — для продуктовых." },
      { title: "Задайте вопрос", desc: "Пишите на обычном языке. Агент найдёт ответ в базе знаний и укажет источники." },
      { title: "Проверьте источники", desc: "Каждый ответ содержит ссылки на документы. Нажмите на источник, чтобы открыть оригинал." },
      { title: "Продолжайте диалог", desc: "Задавайте уточняющие вопросы в том же чате — агент помнит контекст." },
    ],

    docsTips: "Советы для лучших результатов",
    docsTipsList: [
      "Задавайте по одному вопросу за раз — ответ будет точнее.",
      "Проверяйте источники для подтверждения ответов.",
      "Используйте тот же чат для уточняющих вопросов — агент помнит контекст.",
    ],

    docsIconsTitle: "Иконки интерфейса чата",
    docsIconsAiLabel: "В ответах ИИ (появляются при наведении)",
    docsIconsUserLabel: "В ваших сообщениях",
    docsIconsInputLabel: "Поле ввода сообщения",
    docsIconsOtherLabel: "Дополнительно",
    docsIcons: [
      {
        group: "ai",
        icon: "ThumbsUp",
        name: "Хороший ответ",
        desc: "Оцениваете ответ ИИ как полезный. После нажатия иконка становится зелёной и больше не кликается.",
      },
      {
        group: "ai",
        icon: "ThumbsDown",
        name: "Плохой ответ",
        desc: "Отмечаете ответ как неверный или недостаточный. Оценка даётся один раз.",
      },
      {
        group: "ai",
        icon: "RotateCcw",
        name: "Перегенерировать",
        desc: "Появляется только у последнего ответа ИИ. Нажмите, чтобы получить новый вариант ответа.",
      },
      {
        group: "ai",
        icon: "Copy",
        name: "Копировать",
        desc: "Копирует текст ответа в буфер обмена. После копирования показывает ✓ на секунду.",
      },
      {
        group: "user",
        icon: "Pencil",
        name: "Редактировать сообщение",
        desc: "Появляется слева при наведении на ваше сообщение. Можно изменить текст и отправить заново.",
      },
      {
        group: "input",
        icon: "Send",
        name: "Отправить",
        desc: "Отправляет сообщение агенту. То же самое — нажать Enter на клавиатуре.",
      },
      {
        group: "input",
        icon: "Square",
        name: "Остановить",
        desc: "Появляется красным, пока ИИ генерирует ответ. Нажмите, чтобы прервать генерацию.",
      },
      {
        group: "other",
        icon: "ChevronDown",
        name: "Прокрутить вниз",
        desc: "Появляется, когда вы прокрутили чат вверх. Нажмите, чтобы вернуться к последним сообщениям.",
      },
    ],

    docsSecurity: "Безопасность и конфиденциальность",
    docsSecurityBody:
      "Все разговоры обрабатываются во внутренней инфраструктуре банка. Данные не покидают внутреннюю сеть. Чувствительные операции требуют подтверждения человека.",

    docsLimits: "Важные ограничения",
    docsLimitsBody:
      "Агенты отвечают только на основе внутренней базы знаний банка — без использования общих знаний или данных обучения. Если информация не найдена, агент сообщит об этом явно.",

    draftPlaceholder: "Введите сообщение… (Enter — отправить, Shift+Enter — новая строка)",
    draftReadyLabel: "готов к работе",

    backLabel: "Назад",
    homeLabel: "Главная",
    activeLabel: "Активен",
    thinkingLabel: "думает...",
    workingLabel: "работает...",

    cashierTakeTest: "Пройти тест",
    cashierGenerating: "Вопросы генерируются…",
    cashierTimeLeft: "Осталось",
    cashierSubmit: "Отправить тест",
    cashierPassed: "Тест пройден!",
    cashierFailed: "Тест не пройден.",
    cashierTryAgain: "Повторить",
    cashierYourScore: "Ваш результат",
    cashierRetriesLeft: "Попыток осталось",
    cashierQuestion: "Вопрос",
    cashierOf: "из",
    cashierExpired: "Время теста истекло.",
    cashierClose: "Закрыть",
  },

  en: {
    admin: "Admin",
    signOut: "Sign out",

    heroGreeting: "Welcome",
    heroTitle: "Bank AI Platform",
    heroSubtitle: "Your intelligent assistant for banking operations",

    tabAgents: "AI Agents",
    tabDocs: "How to Use",

    agentsSubtitle: "Select an agent to start a conversation or continue from where you left off",
    chats: "chats",
    chatSingle: "chat",
    ctaContinue: "Continue or start new chat",
    ctaStart: "Start a conversation",

    hrCapabilities: [
      "HR policies & procedures",
      "Employment contracts & terms",
      "Leave & attendance rules",
      "Benefits & compensation",
      "Disciplinary procedures",
      "Onboarding guidelines",
    ],

    foCapabilities: [
      "Loan products & interest rates",
      "Account types & features",
      "Customer service procedures",
      "Product eligibility criteria",
      "Fee structures & charges",
      "Regulatory compliance info",
    ],

    cashierCapabilities: [
      "Currency exchange rules",
      "AML/KYC requirements",
      "Cash desk procedures",
      "Documents & transaction limits",
      "Knowledge testing module",
    ],

    moreTopics: "more topics",

    docsWhat: "What is the Bank AI Platform?",
    docsWhatBody:
      "The Bank AI Platform is a secure, on-premises AI assistant built exclusively for bank staff. It connects to specialised knowledge bases so you can get fast, accurate answers about HR policies and customer-facing products.",

    docsStart: "Getting Started",
    docsSteps: [
      { title: "Choose your agent", desc: "Select the HR Agent for staff questions, or the Front Office Agent for customer product inquiries." },
      { title: "Ask your question", desc: "Type in plain language. The agent searches the knowledge base and returns an answer with source references." },
      { title: "Review the sources", desc: "Every answer includes document citations. Click a source to preview the original document." },
      { title: "Continue the conversation", desc: "Ask follow-up questions in the same thread — the agent remembers context." },
    ],

    docsTips: "Tips for Best Results",
    docsTipsList: [
      "Ask one question at a time — you'll get a more focused answer.",
      "Review source citations to verify the information.",
      "Use the same thread for follow-up questions — the agent remembers context.",
    ],

    docsIconsTitle: "Chat Interface Icons",
    docsIconsAiLabel: "On AI responses (visible on hover)",
    docsIconsUserLabel: "On your messages",
    docsIconsInputLabel: "Message input area",
    docsIconsOtherLabel: "Other",
    docsIcons: [
      {
        group: "ai",
        icon: "ThumbsUp",
        name: "Good response",
        desc: "Rate the AI answer as helpful. The icon turns green after clicking and cannot be changed.",
      },
      {
        group: "ai",
        icon: "ThumbsDown",
        name: "Bad response",
        desc: "Mark the answer as incorrect or unhelpful. Feedback is submitted once and cannot be undone.",
      },
      {
        group: "ai",
        icon: "RotateCcw",
        name: "Regenerate",
        desc: "Only appears on the last AI response. Click to ask the agent to produce a new answer.",
      },
      {
        group: "ai",
        icon: "Copy",
        name: "Copy",
        desc: "Copies the AI response text to your clipboard. Shows a ✓ checkmark for one second after copying.",
      },
      {
        group: "user",
        icon: "Pencil",
        name: "Edit message",
        desc: "Appears to the left of your message on hover. Lets you change what you wrote and re-send it.",
      },
      {
        group: "input",
        icon: "Send",
        name: "Send",
        desc: "Sends your message to the agent. Pressing Enter on the keyboard does the same thing.",
      },
      {
        group: "input",
        icon: "Square",
        name: "Stop",
        desc: "Appears in red while the AI is generating a response. Click to interrupt the generation at any time.",
      },
      {
        group: "other",
        icon: "ChevronDown",
        name: "Scroll to bottom",
        desc: "Appears when you have scrolled up in the chat. Click to jump back to the latest messages.",
      },
    ],

    docsSecurity: "Security & Privacy",
    docsSecurityBody:
      "All conversations are processed on-premises within the bank's secure infrastructure. Data never leaves the internal network. Sensitive operations require human approval.",

    docsLimits: "Important Limitations",
    docsLimitsBody:
      "Agents answer only from the bank's internal knowledge base — not from general knowledge or training data. If information is not found, the agent will say so clearly.",

    draftPlaceholder: "Message Bank AI… (Enter to send, Shift+Enter for new line)",
    draftReadyLabel: "ready to help",

    backLabel: "Back",
    homeLabel: "Home",
    activeLabel: "Active",
    thinkingLabel: "thinking...",
    workingLabel: "working...",

    cashierTakeTest: "Take Test",
    cashierGenerating: "Generating questions…",
    cashierTimeLeft: "Time left",
    cashierSubmit: "Submit Test",
    cashierPassed: "Passed!",
    cashierFailed: "Failed.",
    cashierTryAgain: "Try Again",
    cashierYourScore: "Your Score",
    cashierRetriesLeft: "Retries left",
    cashierQuestion: "Question",
    cashierOf: "of",
    cashierExpired: "Test time has expired.",
    cashierClose: "Close",
  },
} as const;

export type Translations = typeof translations.en;

export function useT(): Translations {
  const lang = useChatStore((s) => s.lang);
  return translations[lang] as unknown as Translations;
}
