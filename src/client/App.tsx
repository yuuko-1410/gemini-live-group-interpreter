import {
  Check,
  ChevronDown,
  Copy,
  Globe2,
  Languages,
  Mic,
  MicOff,
  Settings,
  UsersRound,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PcmPlayer, startPcmRecorder, type RecorderHandle } from "./audio/pcm";
import { resolveRoomUrl } from "./room-url";
import {
  DEFAULT_SOURCE_LANGUAGE,
  getLanguageLabel,
  isSupportedLanguage,
  SUPPORTED_LANGUAGES,
  type LanguageCode,
} from "../shared/languages";
import { type MeetingMode, type ServerMessage } from "../shared/ws-protocol";
import { type Meeting } from "../server/meeting-store";

type TranscriptEntry = {
  id: string;
  timestamp: string;
  speakerId?: string;
  speakerName?: string;
  sourceText?: string;
  translatedText?: string;
  language: LanguageCode;
};

type ConnectionStatus = "idle" | "connecting" | "connected" | "offline" | "error";
type WorkspaceView = "transcript" | "members";

type Translation = {
  brand: string;
  copied: string;
  copyLink: string;
  displayName: string;
  empty: string;
  hearingAudio: string;
  errorCreate: string;
  errorMic: string;
  errorNotConnected: string;
  playbackBlocked: string;
  join: string;
  joiningHint: string;
  language: string;
  liveSessionReady: (target: string) => string;
  liveSessionStarting: (target: string) => string;
  members: string;
  modalTitle: string;
  modalSubtitle: string;
  speaking: string;
  sendingAudio: string;
  startSpeaking: string;
  status: Record<ConnectionStatus, string>;
  stopSpeaking: string;
  transcript: string;
  transcriptCount: (count: number) => string;
  translatingOff: string;
  translatingOn: string;
  translatedAudioStats: (received: number, played: number) => string;
  waiting: string;
};

const profileKey = "translate-client-profile";
const transcriptMergeWindowMs = 1000;

const translations: Record<LanguageCode, Translation> = {
  "zh-Hans": {
    brand: "Live Translate",
    copied: "已复制",
    copyLink: "分享链接",
    displayName: "显示名",
    empty: "开始说话后，翻译字幕会按时间滚动显示。",
    hearingAudio: "服务端正在接收语音，等待字幕返回。",
    errorCreate: "无法创建房间，请确认 API 服务和 /api 代理可用。",
    errorMic: "无法打开麦克风。",
    errorNotConnected: "房间尚未连接。",
    playbackBlocked: "浏览器阻止了译音播放，请点一次译音按钮后重试。",
    join: "加入房间",
    joiningHint: "选择语言后才会加入房间。",
    language: "语言",
    liveSessionReady: (target) => `Gemini 会话已就绪 ${target}`,
    liveSessionStarting: (target) => `正在启动 Gemini 会话 ${target}`,
    members: "成员",
    modalTitle: "加入同传房间",
    modalSubtitle: "你的语言会同时用于界面和你听到的同声传译。",
    speaking: "正在说话",
    sendingAudio: "麦克风正在发送语音",
    startSpeaking: "开始说话",
    status: {
      idle: "未加入",
      connecting: "连接中",
      connected: "已连接",
      offline: "已离线",
      error: "连接错误",
    },
    stopSpeaking: "停止说话",
    transcript: "字幕",
    transcriptCount: (count) => `${count} 条`,
    translatingOff: "译音关闭",
    translatingOn: "译音开启",
    translatedAudioStats: (received, played) => `译音 ${played}/${received}`,
    waiting: "等待发言",
  },
  en: {
    brand: "Live Translate",
    copied: "Copied",
    copyLink: "Share link",
    displayName: "Name",
    empty: "Translated captions will appear here as people speak.",
    hearingAudio: "The server is receiving audio and waiting for captions.",
    errorCreate: "Could not create the room. Check the API service and /api proxy.",
    errorMic: "Could not open the microphone.",
    errorNotConnected: "The room is not connected yet.",
    playbackBlocked: "The browser blocked audio playback. Toggle audio once and try again.",
    join: "Join room",
    joiningHint: "You will join the room after choosing a language.",
    language: "Language",
    liveSessionReady: (target) => `Gemini session ready ${target}`,
    liveSessionStarting: (target) => `Starting Gemini session ${target}`,
    members: "Members",
    modalTitle: "Join interpretation room",
    modalSubtitle: "Your language controls both the interface and the interpretation you hear.",
    speaking: "Speaking",
    sendingAudio: "Microphone is sending audio",
    startSpeaking: "Start speaking",
    status: {
      idle: "Not joined",
      connecting: "Connecting",
      connected: "Connected",
      offline: "Offline",
      error: "Connection error",
    },
    stopSpeaking: "Stop speaking",
    transcript: "Captions",
    transcriptCount: (count) => `${count}`,
    translatingOff: "Audio off",
    translatingOn: "Audio on",
    translatedAudioStats: (received, played) => `Audio ${played}/${received}`,
    waiting: "Waiting",
  },
  ja: {
    brand: "Live Translate",
    copied: "コピーしました",
    copyLink: "リンクを共有",
    displayName: "名前",
    empty: "話し始めると翻訳字幕がここに表示されます。",
    hearingAudio: "サーバーが音声を受信しています。字幕を待っています。",
    errorCreate: "ルームを作成できません。API サービスと /api プロキシを確認してください。",
    errorMic: "マイクを開けませんでした。",
    errorNotConnected: "ルームはまだ接続されていません。",
    playbackBlocked: "ブラウザが音声再生をブロックしました。音声ボタンを一度押してから再試行してください。",
    join: "ルームに参加",
    joiningHint: "言語を選択するとルームに参加します。",
    language: "言語",
    liveSessionReady: (target) => `Gemini セッション準備完了 ${target}`,
    liveSessionStarting: (target) => `Gemini セッションを開始中 ${target}`,
    members: "メンバー",
    modalTitle: "通訳ルームに参加",
    modalSubtitle: "選択した言語は画面表示と聞こえる同時通訳に使われます。",
    speaking: "発話中",
    sendingAudio: "マイク音声を送信中",
    startSpeaking: "話し始める",
    status: {
      idle: "未参加",
      connecting: "接続中",
      connected: "接続済み",
      offline: "オフライン",
      error: "接続エラー",
    },
    stopSpeaking: "停止",
    transcript: "字幕",
    transcriptCount: (count) => `${count} 件`,
    translatingOff: "音声オフ",
    translatingOn: "音声オン",
    translatedAudioStats: (received, played) => `音声 ${played}/${received}`,
    waiting: "待機中",
  },
  ko: {
    brand: "Live Translate",
    copied: "복사됨",
    copyLink: "링크 공유",
    displayName: "이름",
    empty: "말을 시작하면 번역 자막이 여기에 표시됩니다.",
    hearingAudio: "서버가 음성을 수신 중이며 자막을 기다리고 있습니다.",
    errorCreate: "방을 만들 수 없습니다. API 서비스와 /api 프록시를 확인하세요.",
    errorMic: "마이크를 열 수 없습니다.",
    errorNotConnected: "방이 아직 연결되지 않았습니다.",
    playbackBlocked: "브라우저가 음성 재생을 차단했습니다. 음성 버튼을 한 번 누른 뒤 다시 시도하세요.",
    join: "방 참가",
    joiningHint: "언어를 선택하면 방에 참가합니다.",
    language: "언어",
    liveSessionReady: (target) => `Gemini 세션 준비됨 ${target}`,
    liveSessionStarting: (target) => `Gemini 세션 시작 중 ${target}`,
    members: "멤버",
    modalTitle: "통역 방 참가",
    modalSubtitle: "선택한 언어는 화면과 들리는 동시통역에 사용됩니다.",
    speaking: "말하는 중",
    sendingAudio: "마이크 음성 전송 중",
    startSpeaking: "말하기 시작",
    status: {
      idle: "미참가",
      connecting: "연결 중",
      connected: "연결됨",
      offline: "오프라인",
      error: "연결 오류",
    },
    stopSpeaking: "중지",
    transcript: "자막",
    transcriptCount: (count) => `${count}개`,
    translatingOff: "음성 끔",
    translatingOn: "음성 켬",
    translatedAudioStats: (received, played) => `음성 ${played}/${received}`,
    waiting: "대기 중",
  },
  es: {
    brand: "Live Translate",
    copied: "Copiado",
    copyLink: "Compartir enlace",
    displayName: "Nombre",
    empty: "Los subtítulos traducidos aparecerán aquí cuando alguien hable.",
    hearingAudio: "El servidor está recibiendo audio y espera subtítulos.",
    errorCreate: "No se pudo crear la sala. Revisa el servicio API y el proxy /api.",
    errorMic: "No se pudo abrir el micrófono.",
    errorNotConnected: "La sala aún no está conectada.",
    playbackBlocked: "El navegador bloqueó el audio. Activa el audio una vez e inténtalo de nuevo.",
    join: "Unirse",
    joiningHint: "Entrarás en la sala después de elegir un idioma.",
    language: "Idioma",
    liveSessionReady: (target) => `Sesión Gemini lista ${target}`,
    liveSessionStarting: (target) => `Iniciando sesión Gemini ${target}`,
    members: "Miembros",
    modalTitle: "Unirse a la sala de interpretación",
    modalSubtitle: "Tu idioma controla la interfaz y la interpretación que escuchas.",
    speaking: "Hablando",
    sendingAudio: "El micrófono está enviando audio",
    startSpeaking: "Empezar a hablar",
    status: {
      idle: "Sin entrar",
      connecting: "Conectando",
      connected: "Conectado",
      offline: "Sin conexión",
      error: "Error de conexión",
    },
    stopSpeaking: "Detener",
    transcript: "Subtítulos",
    transcriptCount: (count) => `${count}`,
    translatingOff: "Audio apagado",
    translatingOn: "Audio encendido",
    translatedAudioStats: (received, played) => `Audio ${played}/${received}`,
    waiting: "Esperando",
  },
  fr: {
    brand: "Live Translate",
    copied: "Copié",
    copyLink: "Partager le lien",
    displayName: "Nom",
    empty: "Les sous-titres traduits apparaîtront ici quand quelqu'un parlera.",
    hearingAudio: "Le serveur reçoit l'audio et attend les sous-titres.",
    errorCreate: "Impossible de créer la salle. Vérifiez le service API et le proxy /api.",
    errorMic: "Impossible d'ouvrir le micro.",
    errorNotConnected: "La salle n'est pas encore connectée.",
    playbackBlocked: "Le navigateur a bloqué l'audio. Activez l'audio une fois puis réessayez.",
    join: "Rejoindre",
    joiningHint: "Vous rejoindrez la salle après avoir choisi une langue.",
    language: "Langue",
    liveSessionReady: (target) => `Session Gemini prête ${target}`,
    liveSessionStarting: (target) => `Démarrage de la session Gemini ${target}`,
    members: "Membres",
    modalTitle: "Rejoindre la salle d'interprétation",
    modalSubtitle: "Votre langue contrôle l'interface et l'interprétation que vous entendez.",
    speaking: "Parle",
    sendingAudio: "Le micro envoie l'audio",
    startSpeaking: "Parler",
    status: {
      idle: "Non rejoint",
      connecting: "Connexion",
      connected: "Connecté",
      offline: "Hors ligne",
      error: "Erreur de connexion",
    },
    stopSpeaking: "Arrêter",
    transcript: "Sous-titres",
    transcriptCount: (count) => `${count}`,
    translatingOff: "Audio désactivé",
    translatingOn: "Audio activé",
    translatedAudioStats: (received, played) => `Audio ${played}/${received}`,
    waiting: "En attente",
  },
  de: {
    brand: "Live Translate",
    copied: "Kopiert",
    copyLink: "Link teilen",
    displayName: "Name",
    empty: "Übersetzte Untertitel erscheinen hier, sobald jemand spricht.",
    hearingAudio: "Der Server empfängt Audio und wartet auf Untertitel.",
    errorCreate: "Raum konnte nicht erstellt werden. Prüfe API-Dienst und /api-Proxy.",
    errorMic: "Mikrofon konnte nicht geöffnet werden.",
    errorNotConnected: "Der Raum ist noch nicht verbunden.",
    playbackBlocked: "Der Browser hat die Audiowiedergabe blockiert. Schalte Audio einmal um und versuche es erneut.",
    join: "Beitreten",
    joiningHint: "Nach der Sprachauswahl trittst du dem Raum bei.",
    language: "Sprache",
    liveSessionReady: (target) => `Gemini-Sitzung bereit ${target}`,
    liveSessionStarting: (target) => `Gemini-Sitzung startet ${target}`,
    members: "Mitglieder",
    modalTitle: "Dolmetschraum beitreten",
    modalSubtitle: "Deine Sprache steuert die Oberfläche und die Verdolmetschung, die du hörst.",
    speaking: "Spricht",
    sendingAudio: "Mikrofon sendet Audio",
    startSpeaking: "Sprechen",
    status: {
      idle: "Nicht beigetreten",
      connecting: "Verbinden",
      connected: "Verbunden",
      offline: "Offline",
      error: "Verbindungsfehler",
    },
    stopSpeaking: "Stoppen",
    transcript: "Untertitel",
    transcriptCount: (count) => `${count}`,
    translatingOff: "Audio aus",
    translatingOn: "Audio an",
    translatedAudioStats: (received, played) => `Audio ${played}/${received}`,
    waiting: "Warten",
  },
  "pt-BR": {
    brand: "Live Translate",
    copied: "Copiado",
    copyLink: "Compartilhar link",
    displayName: "Nome",
    empty: "As legendas traduzidas aparecerão aqui quando alguém falar.",
    hearingAudio: "O servidor está recebendo áudio e aguardando legendas.",
    errorCreate: "Não foi possível criar a sala. Verifique o serviço de API e o proxy /api.",
    errorMic: "Não foi possível abrir o microfone.",
    errorNotConnected: "A sala ainda não está conectada.",
    playbackBlocked: "O navegador bloqueou o áudio. Ative o áudio uma vez e tente novamente.",
    join: "Entrar",
    joiningHint: "Você entrará na sala depois de escolher um idioma.",
    language: "Idioma",
    liveSessionReady: (target) => `Sessão Gemini pronta ${target}`,
    liveSessionStarting: (target) => `Iniciando sessão Gemini ${target}`,
    members: "Membros",
    modalTitle: "Entrar na sala de interpretação",
    modalSubtitle: "Seu idioma controla a interface e a interpretação que você ouve.",
    speaking: "Falando",
    sendingAudio: "Microfone enviando áudio",
    startSpeaking: "Começar a falar",
    status: {
      idle: "Fora da sala",
      connecting: "Conectando",
      connected: "Conectado",
      offline: "Offline",
      error: "Erro de conexão",
    },
    stopSpeaking: "Parar",
    transcript: "Legendas",
    transcriptCount: (count) => `${count}`,
    translatingOff: "Áudio desligado",
    translatingOn: "Áudio ligado",
    translatedAudioStats: (received, played) => `Áudio ${played}/${received}`,
    waiting: "Aguardando",
  },
  it: {
    brand: "Live Translate",
    copied: "Copiato",
    copyLink: "Condividi link",
    displayName: "Nome",
    empty: "I sottotitoli tradotti appariranno qui quando qualcuno parla.",
    hearingAudio: "Il server sta ricevendo audio e attende i sottotitoli.",
    errorCreate: "Impossibile creare la stanza. Controlla il servizio API e il proxy /api.",
    errorMic: "Impossibile aprire il microfono.",
    errorNotConnected: "La stanza non è ancora connessa.",
    playbackBlocked: "Il browser ha bloccato l'audio. Attiva l'audio una volta e riprova.",
    join: "Entra",
    joiningHint: "Entrerai nella stanza dopo aver scelto una lingua.",
    language: "Lingua",
    liveSessionReady: (target) => `Sessione Gemini pronta ${target}`,
    liveSessionStarting: (target) => `Avvio sessione Gemini ${target}`,
    members: "Membri",
    modalTitle: "Entra nella stanza di interpretazione",
    modalSubtitle: "La tua lingua controlla l'interfaccia e l'interpretazione che ascolti.",
    speaking: "Sta parlando",
    sendingAudio: "Il microfono sta inviando audio",
    startSpeaking: "Parla",
    status: {
      idle: "Non entrato",
      connecting: "Connessione",
      connected: "Connesso",
      offline: "Offline",
      error: "Errore di connessione",
    },
    stopSpeaking: "Ferma",
    transcript: "Sottotitoli",
    transcriptCount: (count) => `${count}`,
    translatingOff: "Audio spento",
    translatingOn: "Audio acceso",
    translatedAudioStats: (received, played) => `Audio ${played}/${received}`,
    waiting: "In attesa",
  },
  ru: {
    brand: "Live Translate",
    copied: "Скопировано",
    copyLink: "Поделиться",
    displayName: "Имя",
    empty: "Переведенные субтитры появятся здесь во время речи.",
    hearingAudio: "Сервер получает звук и ждет субтитры.",
    errorCreate: "Не удалось создать комнату. Проверьте API и прокси /api.",
    errorMic: "Не удалось открыть микрофон.",
    errorNotConnected: "Комната еще не подключена.",
    playbackBlocked: "Браузер заблокировал звук. Нажмите кнопку звука и попробуйте снова.",
    join: "Войти",
    joiningHint: "Вы войдете в комнату после выбора языка.",
    language: "Язык",
    liveSessionReady: (target) => `Сессия Gemini готова ${target}`,
    liveSessionStarting: (target) => `Запуск сессии Gemini ${target}`,
    members: "Участники",
    modalTitle: "Войти в комнату перевода",
    modalSubtitle: "Язык используется для интерфейса и перевода, который вы слышите.",
    speaking: "Говорит",
    sendingAudio: "Микрофон отправляет звук",
    startSpeaking: "Говорить",
    status: {
      idle: "Не вошли",
      connecting: "Подключение",
      connected: "Подключено",
      offline: "Офлайн",
      error: "Ошибка",
    },
    stopSpeaking: "Остановить",
    transcript: "Субтитры",
    transcriptCount: (count) => `${count}`,
    translatingOff: "Звук выкл.",
    translatingOn: "Звук вкл.",
    translatedAudioStats: (received, played) => `Звук ${played}/${received}`,
    waiting: "Ожидание",
  },
  ar: {
    brand: "Live Translate",
    copied: "تم النسخ",
    copyLink: "مشاركة الرابط",
    displayName: "الاسم",
    empty: "ستظهر الترجمات هنا عندما يبدأ الأشخاص في الحديث.",
    hearingAudio: "الخادم يستقبل الصوت وينتظر الترجمة.",
    errorCreate: "تعذر إنشاء الغرفة. تحقق من خدمة API ووكيل /api.",
    errorMic: "تعذر فتح الميكروفون.",
    errorNotConnected: "الغرفة غير متصلة بعد.",
    playbackBlocked: "حظر المتصفح تشغيل الصوت. فعّل الصوت مرة واحدة ثم حاول مجددًا.",
    join: "انضمام",
    joiningHint: "ستنضم إلى الغرفة بعد اختيار اللغة.",
    language: "اللغة",
    liveSessionReady: (target) => `جلسة Gemini جاهزة ${target}`,
    liveSessionStarting: (target) => `بدء جلسة Gemini ${target}`,
    members: "الأعضاء",
    modalTitle: "الانضمام إلى غرفة الترجمة",
    modalSubtitle: "تتحكم لغتك في الواجهة وفي الترجمة الفورية التي تسمعها.",
    speaking: "يتحدث",
    sendingAudio: "الميكروفون يرسل الصوت",
    startSpeaking: "بدء التحدث",
    status: {
      idle: "لم تنضم",
      connecting: "جار الاتصال",
      connected: "متصل",
      offline: "غير متصل",
      error: "خطأ في الاتصال",
    },
    stopSpeaking: "إيقاف",
    transcript: "الترجمة",
    transcriptCount: (count) => `${count}`,
    translatingOff: "الصوت متوقف",
    translatingOn: "الصوت يعمل",
    translatedAudioStats: (received, played) => `الصوت ${played}/${received}`,
    waiting: "انتظار",
  },
  hi: {
    brand: "Live Translate",
    copied: "कॉपी किया गया",
    copyLink: "लिंक साझा करें",
    displayName: "नाम",
    empty: "लोगों के बोलने पर अनुवादित कैप्शन यहां दिखेंगे।",
    hearingAudio: "सर्वर ऑडियो प्राप्त कर रहा है और कैप्शन की प्रतीक्षा कर रहा है।",
    errorCreate: "रूम नहीं बन सका। API सेवा और /api प्रॉक्सी जांचें।",
    errorMic: "माइक्रोफोन नहीं खुल सका।",
    errorNotConnected: "रूम अभी कनेक्ट नहीं है।",
    playbackBlocked: "ब्राउज़र ने ऑडियो प्लेबैक रोक दिया। ऑडियो बटन एक बार दबाकर फिर कोशिश करें।",
    join: "रूम में जाएं",
    joiningHint: "भाषा चुनने के बाद आप रूम में जाएंगे।",
    language: "भाषा",
    liveSessionReady: (target) => `Gemini सत्र तैयार ${target}`,
    liveSessionStarting: (target) => `Gemini सत्र शुरू हो रहा है ${target}`,
    members: "सदस्य",
    modalTitle: "अनुवाद रूम में जाएं",
    modalSubtitle: "आपकी भाषा इंटरफेस और सुने जाने वाले लाइव अनुवाद दोनों को नियंत्रित करती है।",
    speaking: "बोल रहे हैं",
    sendingAudio: "माइक्रोफोन ऑडियो भेज रहा है",
    startSpeaking: "बोलना शुरू करें",
    status: {
      idle: "शामिल नहीं",
      connecting: "कनेक्ट हो रहा है",
      connected: "कनेक्टेड",
      offline: "ऑफलाइन",
      error: "कनेक्शन त्रुटि",
    },
    stopSpeaking: "रोकें",
    transcript: "कैप्शन",
    transcriptCount: (count) => `${count}`,
    translatingOff: "ऑडियो बंद",
    translatingOn: "ऑडियो चालू",
    translatedAudioStats: (received, played) => `ऑडियो ${played}/${received}`,
    waiting: "प्रतीक्षा",
  },
  th: {
    brand: "Live Translate",
    copied: "คัดลอกแล้ว",
    copyLink: "แชร์ลิงก์",
    displayName: "ชื่อ",
    empty: "คำบรรยายที่แปลแล้วจะแสดงที่นี่เมื่อมีคนพูด",
    hearingAudio: "เซิร์ฟเวอร์กำลังรับเสียงและรอคำบรรยาย",
    errorCreate: "สร้างห้องไม่ได้ โปรดตรวจสอบบริการ API และพร็อกซี /api",
    errorMic: "เปิดไมโครโฟนไม่ได้",
    errorNotConnected: "ห้องยังไม่ได้เชื่อมต่อ",
    playbackBlocked: "เบราว์เซอร์บล็อกการเล่นเสียง กดปุ่มเสียงหนึ่งครั้งแล้วลองอีกครั้ง",
    join: "เข้าห้อง",
    joiningHint: "คุณจะเข้าห้องหลังจากเลือกภาษา",
    language: "ภาษา",
    liveSessionReady: (target) => `เซสชัน Gemini พร้อมแล้ว ${target}`,
    liveSessionStarting: (target) => `กำลังเริ่มเซสชัน Gemini ${target}`,
    members: "สมาชิก",
    modalTitle: "เข้าห้องล่าม",
    modalSubtitle: "ภาษาของคุณใช้กับทั้งหน้าจอและเสียงแปลสดที่คุณได้ยิน",
    speaking: "กำลังพูด",
    sendingAudio: "ไมโครโฟนกำลังส่งเสียง",
    startSpeaking: "เริ่มพูด",
    status: {
      idle: "ยังไม่เข้าร่วม",
      connecting: "กำลังเชื่อมต่อ",
      connected: "เชื่อมต่อแล้ว",
      offline: "ออฟไลน์",
      error: "ข้อผิดพลาดการเชื่อมต่อ",
    },
    stopSpeaking: "หยุด",
    transcript: "คำบรรยาย",
    transcriptCount: (count) => `${count}`,
    translatingOff: "ปิดเสียง",
    translatingOn: "เปิดเสียง",
    translatedAudioStats: (received, played) => `เสียง ${played}/${received}`,
    waiting: "รอ",
  },
  vi: {
    brand: "Live Translate",
    copied: "Đã sao chép",
    copyLink: "Chia sẻ liên kết",
    displayName: "Tên",
    empty: "Phụ đề đã dịch sẽ xuất hiện ở đây khi mọi người nói.",
    hearingAudio: "Máy chủ đang nhận âm thanh và chờ phụ đề.",
    errorCreate: "Không thể tạo phòng. Kiểm tra dịch vụ API và proxy /api.",
    errorMic: "Không thể mở micro.",
    errorNotConnected: "Phòng chưa được kết nối.",
    playbackBlocked: "Trình duyệt đã chặn phát âm thanh. Bật âm thanh một lần rồi thử lại.",
    join: "Vào phòng",
    joiningHint: "Bạn sẽ vào phòng sau khi chọn ngôn ngữ.",
    language: "Ngôn ngữ",
    liveSessionReady: (target) => `Phiên Gemini đã sẵn sàng ${target}`,
    liveSessionStarting: (target) => `Đang khởi động phiên Gemini ${target}`,
    members: "Thành viên",
    modalTitle: "Vào phòng phiên dịch",
    modalSubtitle: "Ngôn ngữ của bạn dùng cho giao diện và phần phiên dịch bạn nghe.",
    speaking: "Đang nói",
    sendingAudio: "Micro đang gửi âm thanh",
    startSpeaking: "Bắt đầu nói",
    status: {
      idle: "Chưa vào",
      connecting: "Đang kết nối",
      connected: "Đã kết nối",
      offline: "Ngoại tuyến",
      error: "Lỗi kết nối",
    },
    stopSpeaking: "Dừng",
    transcript: "Phụ đề",
    transcriptCount: (count) => `${count}`,
    translatingOff: "Tắt âm thanh",
    translatingOn: "Bật âm thanh",
    translatedAudioStats: (received, played) => `Âm thanh ${played}/${received}`,
    waiting: "Đang chờ",
  },
  id: {
    brand: "Live Translate",
    copied: "Disalin",
    copyLink: "Bagikan tautan",
    displayName: "Nama",
    empty: "Teks terjemahan akan muncul di sini saat orang berbicara.",
    hearingAudio: "Server sedang menerima audio dan menunggu teks.",
    errorCreate: "Tidak dapat membuat ruang. Periksa layanan API dan proxy /api.",
    errorMic: "Tidak dapat membuka mikrofon.",
    errorNotConnected: "Ruang belum terhubung.",
    playbackBlocked: "Browser memblokir pemutaran audio. Aktifkan audio sekali lalu coba lagi.",
    join: "Masuk ruang",
    joiningHint: "Anda akan masuk ruang setelah memilih bahasa.",
    language: "Bahasa",
    liveSessionReady: (target) => `Sesi Gemini siap ${target}`,
    liveSessionStarting: (target) => `Memulai sesi Gemini ${target}`,
    members: "Anggota",
    modalTitle: "Masuk ruang interpretasi",
    modalSubtitle: "Bahasa Anda mengatur antarmuka dan interpretasi yang Anda dengar.",
    speaking: "Berbicara",
    sendingAudio: "Mikrofon mengirim audio",
    startSpeaking: "Mulai bicara",
    status: {
      idle: "Belum masuk",
      connecting: "Menghubungkan",
      connected: "Terhubung",
      offline: "Offline",
      error: "Kesalahan koneksi",
    },
    stopSpeaking: "Berhenti",
    transcript: "Teks",
    transcriptCount: (count) => `${count}`,
    translatingOff: "Audio mati",
    translatingOn: "Audio nyala",
    translatedAudioStats: (received, played) => `Audio ${played}/${received}`,
    waiting: "Menunggu",
  },
};

export function App() {
  const initialRoom = useMemo(() => {
    const resolved = resolveRoomUrl(window.location.href);
    if (resolved.created) {
      window.history.replaceState(null, "", resolved.href);
    }
    return resolved;
  }, []);
  const initialProfile = useMemo(() => loadProfile(), []);

  const [roomId] = useState(initialRoom.roomId);
  const [displayName, setDisplayName] = useState(initialProfile.displayName);
  const [language, setLanguage] = useState<LanguageCode>(initialProfile.language);
  const [hasJoined, setHasJoined] = useState(false);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [micOn, setMicOn] = useState(false);
  const [audioOn, setAudioOn] = useState(true);
  const [level, setLevel] = useState(0);
  const [lastAudioActivityAt, setLastAudioActivityAt] = useState<number | null>(null);
  const [receivedAudioChunks, setReceivedAudioChunks] = useState(0);
  const [playedAudioChunks, setPlayedAudioChunks] = useState(0);
  const [lastLiveStatus, setLastLiveStatus] = useState<Extract<
    ServerMessage,
    { type: "live_status" }
  > | null>(null);
  const [sentAudioChunks, setSentAudioChunks] = useState(0);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("transcript");
  const [copied, setCopied] = useState(false);
  const [modeDialogOpen, setModeDialogOpen] = useState(false);
  const [playbackActive, setPlaybackActive] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<RecorderHandle | null>(null);
  const playerRef = useRef(new PcmPlayer());
  const t = getTranslation(language);
  const audioOnRef = useRef(audioOn);
  const participantIdRef = useRef(participantId);
  const pendingMicStartRef = useRef(false);
  const recordingStartTokenRef = useRef(0);
  const playbackActiveRef = useRef(playbackActive);
  const translationRef = useRef(t);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    audioOnRef.current = audioOn;
  }, [audioOn]);

  useEffect(() => {
    playbackActiveRef.current = playbackActive;
  }, [playbackActive]);

  useEffect(() => {
    participantIdRef.current = participantId;
  }, [participantId]);

  useEffect(() => {
    translationRef.current = t;
  }, [t]);

  useEffect(() => {
    saveProfile({ displayName, language });
  }, [displayName, language]);

  useEffect(() => {
    if (!hasJoined) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    function leaveRoom() {
      try {
        wsRef.current?.send(JSON.stringify({ type: "stop_speaking" }));
        wsRef.current?.close();
      } catch {
        // Browser shutdown can interrupt cleanup; the server also handles socket close.
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", leaveRoom);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", leaveRoom);
    };
  }, [hasJoined]);

  useEffect(() => {
    if (!hasJoined) return;

    let cancelled = false;
    let joined = false;
    setStatus("connecting");
    setError(null);
    setReceivedAudioChunks(0);
    setPlayedAudioChunks(0);

    async function connectRoom() {
      try {
        const createResponse = await fetchWithTimeout(
          "/api/meetings",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              meetingId: roomId,
              hostName: displayName,
              hostLanguage: language,
              empty: true,
            }),
          },
          5000,
        );
        if (!createResponse.ok) {
          throw new Error("create_meeting_failed");
        }

        if (cancelled) return;
        openMeetingSocket();
      } catch {
        setStatus("error");
        setError(t.errorCreate);
      }
    }

    function openMeetingSocket() {
      const url = createMeetingSocketUrl(roomId);
      if (cancelled || joined) return;

      try {
        const ws = new WebSocket(url);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;
        const openTimer = window.setTimeout(() => {
          if (joined || cancelled) return;
          setStatus("error");
          setError(`WebSocket timeout: ${formatSocketUrl(url)}`);
          ws.close();
        }, 5000);

        ws.addEventListener("open", () => {
          setStatus("connected");
          setError(null);
          ws.send(
            JSON.stringify({
              type: "join",
              displayName,
              language,
            }),
          );
        });

        ws.addEventListener("message", (event) => {
          if (typeof event.data === "string") {
            handleServerMessage(JSON.parse(event.data) as ServerMessage);
            return;
          }

          const audio =
            event.data instanceof ArrayBuffer
              ? new Uint8Array(event.data)
              : event.data instanceof Blob
                ? null
                : new Uint8Array();
          if (!audio) return;

          setReceivedAudioChunks((count) => count + 1);
          console.info(`[client-audio] received translated audio bytes=${audio.byteLength}`);
          if (!audioOnRef.current) return;

          void playerRef.current
            .play(audio)
            .then(() => {
              setPlayedAudioChunks((count) => count + 1);
              console.info(`[client-audio] played translated audio bytes=${audio.byteLength}`);
            })
            .catch((playError) => {
              console.error("[client-audio] playback failed", playError);
              setError(translationRef.current.playbackBlocked);
            });
        });

        ws.addEventListener("close", (event) => {
          window.clearTimeout(openTimer);
          setStatus((current) => (current === "error" ? "error" : "offline"));
          if (!joined && !cancelled) {
            setStatus("error");
            setError(`WebSocket closed before join: ${formatSocketUrl(url)}, code ${event.code}`);
          }
          recordingStartTokenRef.current += 1;
          pendingMicStartRef.current = false;
          setMicOn(false);
          stopRecorder();
        });

        ws.addEventListener("error", () => {
          window.clearTimeout(openTimer);
          setStatus("error");
          setError(`WebSocket error: ${formatSocketUrl(url)}`);
        });
      } catch {
        setStatus("error");
        setError(`Could not open WebSocket: ${formatSocketUrl(url)}`);
      }
    }

    function handleServerMessage(message: ServerMessage) {
      if (message.type === "joined") {
        joined = true;
        setStatus("connected");
        setError(null);
        participantIdRef.current = message.participantId;
        setParticipantId(message.participantId);
        void refreshMeeting(roomId);
      }

      if (message.type === "meeting_state") {
        const nextMeeting = message.meeting as Meeting;
        setMeeting(nextMeeting);
        playbackActiveRef.current = nextMeeting.playbackActive;
        setPlaybackActive(nextMeeting.playbackActive);
      }

      if (message.type === "speaker_changed") {
        setMeeting((current) =>
          current ? { ...current, activeSpeakerId: message.speakerId } : current,
        );
        if (message.speakerId === participantIdRef.current && pendingMicStartRef.current) {
          const token = recordingStartTokenRef.current;
          pendingMicStartRef.current = false;
          void startGrantedRecording(token);
        }
      }

      if (message.type === "mode_changed") {
        setMeeting((current) => (current ? { ...current, mode: message.mode } : current));
      }

      if (message.type === "playback_started") {
        setPlaybackActive(true);
        playbackActiveRef.current = true;
        recordingStartTokenRef.current += 1;
        pendingMicStartRef.current = false;
        setMicOn(false);
        stopRecorder();
      }

      if (message.type === "playback_finished") {
        setPlaybackActive(false);
        playbackActiveRef.current = false;
      }

      if (message.type === "audio_activity") {
        setLastAudioActivityAt(Date.parse(message.timestamp));
      }

      if (message.type === "live_status") {
        setLastLiveStatus(message);
      }

      if (message.type === "transcript") {
        setTranscripts((current) => mergeTranscriptEntry(current, message));
      }

      if (message.type === "error") {
        setError(message.message);
        if (message.code === "speaker_busy") {
          recordingStartTokenRef.current += 1;
          pendingMicStartRef.current = false;
          setMicOn(false);
          stopRecorder();
        }
      }
    }

    void connectRoom();

    return () => {
      cancelled = true;
      recordingStartTokenRef.current += 1;
      pendingMicStartRef.current = false;
      stopRecorder();
      wsRef.current?.close();
      wsRef.current = null;
      playerRef.current.reset();
    };
  }, [hasJoined, roomId]);

  useEffect(() => {
    if (hasJoined && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "set_language", language }));
    }
  }, [hasJoined, language]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcripts]);

  const activeSpeaker = meeting?.participants.find((item) => item.id === meeting.activeSpeakerId);
  const meetingMode = meeting?.mode ?? "simultaneous";
  const roomPlaybackActive = playbackActive || Boolean(meeting?.playbackActive);
  const activeOtherSpeaker =
    activeSpeaker && activeSpeaker.id !== participantId ? activeSpeaker : null;
  const hasRecentAudioActivity =
    lastAudioActivityAt !== null && Date.now() - lastAudioActivityAt < 2500;
  const liveStatusText = lastLiveStatus ? formatLiveStatus(lastLiveStatus, language) : null;
  const connectionInterrupted =
    hasJoined && (status === "offline" || status === "error");
  const memberRows = meeting?.participants.length
    ? meeting.participants
    : participantId
      ? [
          {
            id: participantId,
            displayName,
            language,
            role: "listener" as const,
            connectedAt: new Date().toISOString(),
          },
        ]
      : [];

  async function refreshMeeting(id: string) {
    try {
      const response = await fetchWithTimeout(`/api/meetings/${encodeURIComponent(id)}`, {}, 4000);
      if (!response.ok) return;
      const body = (await response.json()) as { meeting?: Meeting };
      if (body.meeting) {
        setMeeting(body.meeting);
      }
    } catch {
      // WebSocket broadcasts remain the primary state path.
    }
  }

  async function toggleMic() {
    if (micOn) {
      recordingStartTokenRef.current += 1;
      pendingMicStartRef.current = false;
      wsRef.current?.send(JSON.stringify({ type: "stop_speaking" }));
      setMicOn(false);
      setSentAudioChunks(0);
      setMeeting((current) => (current ? { ...current, activeSpeakerId: null } : current));
      stopRecorder();
      return;
    }

    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setError(t.errorNotConnected);
      return;
    }

    if (roomPlaybackActive) {
      setError(getModeCopy(language).playbackBusy);
      return;
    }

    if (activeOtherSpeaker) {
      setError(getModeCopy(language).speakerBusy(activeOtherSpeaker.displayName));
      return;
    }

    try {
      if (audioOn) await playerRef.current.unlock();
      recordingStartTokenRef.current += 1;
      pendingMicStartRef.current = true;
      wsRef.current.send(JSON.stringify({ type: "start_speaking" }));
      setSentAudioChunks(0);
      setError(null);
    } catch {
      setError(t.errorMic);
      recordingStartTokenRef.current += 1;
      pendingMicStartRef.current = false;
      setMicOn(false);
      setSentAudioChunks(0);
      stopRecorder();
    }
  }

  async function startGrantedRecording(token: number) {
    if (recorderRef.current || wsRef.current?.readyState !== WebSocket.OPEN) return;

    try {
      const recorder = await startPcmRecorder((chunk) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(chunk);
          setSentAudioChunks((count) => count + 1);
        }
      }, setLevel);
      if (recordingStartTokenRef.current !== token || playbackActiveRef.current) {
        recorder.stop();
        setLevel(0);
        return;
      }
      recorderRef.current = recorder;
      setMicOn(true);
      setError(null);
    } catch {
      setError(translationRef.current.errorMic);
      setMicOn(false);
      setSentAudioChunks(0);
      wsRef.current?.send(JSON.stringify({ type: "stop_speaking" }));
      stopRecorder();
    }
  }

  function joinRoom() {
    const trimmedName = displayName.trim();
    setDisplayName(trimmedName || fallbackName());
    setHasJoined(true);
  }

  function stopRecorder() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setLevel(0);
  }

  async function copyLink() {
    await navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1300);
  }

  function changeMeetingMode(mode: MeetingMode) {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setError(t.errorNotConnected);
      return;
    }
    if (micOn) {
      recordingStartTokenRef.current += 1;
      pendingMicStartRef.current = false;
      wsRef.current.send(JSON.stringify({ type: "stop_speaking" }));
      setMicOn(false);
      stopRecorder();
    }
    if (pendingMicStartRef.current) {
      recordingStartTokenRef.current += 1;
      pendingMicStartRef.current = false;
    }
    wsRef.current.send(JSON.stringify({ type: "set_mode", mode }));
    setMeeting((current) => (current ? { ...current, mode } : current));
    setModeDialogOpen(false);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="topbarLeft">
          <LanguagePicker
            label={t.language}
            onChange={setLanguage}
            value={language}
            variant="top"
          />
          <StatusPill status={status} t={t} />
        </div>
        <div className="topCenter">
          <div className="viewSwitch" aria-label="Workspace view">
            <button
              className={workspaceView === "transcript" ? "active" : ""}
              type="button"
              onClick={() => setWorkspaceView("transcript")}
            >
              {t.transcript}
            </button>
            <button
              className={workspaceView === "members" ? "active" : ""}
              type="button"
              onClick={() => setWorkspaceView("members")}
            >
              {t.members}
            </button>
          </div>
        </div>
        <button
          className={audioOn ? "audioToggle active" : "audioToggle"}
          type="button"
          aria-label={audioOn ? t.translatingOn : t.translatingOff}
          title={audioOn ? t.translatingOn : t.translatingOff}
          onClick={() => {
            setAudioOn((current) => {
              const next = !current;
              if (next) {
                void playerRef.current.unlock().catch(() => setError(t.playbackBlocked));
              } else {
                playerRef.current.reset();
              }
              return next;
            });
          }}
        >
          {audioOn ? <Volume2 size={22} /> : <VolumeX size={22} />}
        </button>
      </header>

      <section className={`workspace view-${workspaceView}`}>
        <section className="transcriptPanel" aria-label={t.transcript}>
          <div className="transcriptList">
            {transcripts.length === 0 ? (
              <div className="emptyTranscript">
                <Languages size={42} />
                <p>
                  {hasJoined
                    ? liveStatusText
                      ? liveStatusText
                      : hasRecentAudioActivity
                      ? t.hearingAudio
                      : t.empty
                    : t.joiningHint}
                </p>
              </div>
            ) : (
              transcripts.map((item, index) => (
                <article className="transcriptItem" key={item.id}>
                  <div className="transcriptMeta">
                    <time>{formatTime(item.timestamp, language)}</time>
                    <div className="speakerRow">
                      <strong>{item.speakerName ?? "Speaker"}</strong>
                      <span>{getLanguageLabel(item.language)}</span>
                    </div>
                  </div>
                  <div className="transcriptBody">
                    {item.sourceText ? <p className="sourceText">{item.sourceText}</p> : null}
                    <p
                      className={
                        index === transcripts.length - 1 ? "translatedText live" : "translatedText"
                      }
                    >
                      {item.translatedText ?? item.sourceText ?? "..."}
                    </p>
                  </div>
                </article>
              ))
            )}
            <div ref={transcriptEndRef} />
          </div>
        </section>

        <aside className="sidePanel" aria-label={t.members}>
          <button className="shareButton" type="button" onClick={copyLink}>
            <span>{copied ? t.copied : t.copyLink}</span>
            <Copy size={17} />
          </button>

          <section className="memberSection">
            <div className="sectionTitle">
              <UsersRound size={17} />
              <h3>{t.members}</h3>
            </div>
            <div className="participantList">
              {memberRows.map((participant) => {
                const speaking = participant.id === meeting?.activeSpeakerId;
                return (
                  <div className={speaking ? "participant speaking" : "participant"} key={participant.id}>
                    {speaking ? <span className="participantWave" aria-hidden="true" /> : null}
                    <strong>{participant.displayName}</strong>
                    <span className="participantLanguage">{getLanguageLabel(participant.language)}</span>
                    {speaking ? <i>{t.speaking}</i> : null}
                  </div>
                );
              })}
              {hasJoined && !meeting && !participantId ? (
                <p className="muted">{error ?? t.status.connecting}</p>
              ) : null}
              {!hasJoined ? <p className="muted">{t.joiningHint}</p> : null}
            </div>
          </section>
        </aside>
      </section>

      <footer className="controlDock">
        <button
          className={micOn ? "primaryControl recording" : "primaryControl"}
          disabled={!hasJoined || status !== "connected" || roomPlaybackActive}
          type="button"
          onClick={() => void toggleMic()}
        >
          {micOn ? <Waveform active={micOn} level={level} /> : null}
          {micOn ? <MicOff size={22} /> : <Mic size={22} />}
          <span>
            {roomPlaybackActive
              ? getModeCopy(language).playing
              : micOn
                ? t.stopSpeaking
                : t.startSpeaking}
          </span>
        </button>
        <button
          className="modeControl"
          type="button"
          aria-label={getModeCopy(language).openModes}
          title={getModeCopy(language).openModes}
          onClick={() => setModeDialogOpen(true)}
        >
          <Settings size={21} />
        </button>
      </footer>

      {!hasJoined ? (
        <JoinDialog
          displayName={displayName}
          language={language}
          onDisplayNameChange={setDisplayName}
          onJoin={joinRoom}
          onLanguageChange={setLanguage}
          t={t}
        />
      ) : null}

      {connectionInterrupted ? (
        <ConnectionDialog
          message={error ?? t.status[status]}
          onRejoin={() => window.location.reload()}
          t={t}
        />
      ) : null}

      {modeDialogOpen ? (
        <ModeDialog
          language={language}
          mode={meetingMode}
          onClose={() => setModeDialogOpen(false)}
          onSelect={changeMeetingMode}
        />
      ) : null}

      {error && !connectionInterrupted ? <div className="toast">{error}</div> : null}
    </main>
  );
}

function ConnectionDialog({
  message,
  onRejoin,
  t,
}: {
  message: string;
  onRejoin(): void;
  t: Translation;
}) {
  return (
    <div className="connectionOverlay" role="presentation">
      <section className="connectionDialog" aria-label={t.status.offline} role="dialog">
        <div>
          <h2>{t.status.offline}</h2>
          <p>{message}</p>
        </div>
        <button className="joinButton" type="button" onClick={onRejoin}>
          {t.join}
        </button>
      </section>
    </div>
  );
}

function JoinDialog({
  displayName,
  language,
  onDisplayNameChange,
  onJoin,
  onLanguageChange,
  t,
}: {
  displayName: string;
  language: LanguageCode;
  onDisplayNameChange(value: string): void;
  onJoin(): void;
  onLanguageChange(value: LanguageCode): void;
  t: Translation;
}) {
  return (
    <div className="joinOverlay" role="presentation">
      <section className="joinDialog" aria-label={t.modalTitle} role="dialog">
        <div>
          <h2>{t.modalTitle}</h2>
          <p>{t.modalSubtitle}</p>
        </div>
        <label>
          <span>{t.displayName}</span>
          <input
            autoFocus
            value={displayName}
            onChange={(event) => onDisplayNameChange(event.target.value)}
            maxLength={32}
          />
        </label>
        <div className="formField">
          <span>{t.language}</span>
          <LanguagePicker
            label={t.language}
            onChange={onLanguageChange}
            value={language}
            variant="dialog"
          />
        </div>
        <button className="joinButton" type="button" onClick={onJoin}>
          {t.join}
        </button>
      </section>
    </div>
  );
}

function ModeDialog({
  language,
  mode,
  onClose,
  onSelect,
}: {
  language: LanguageCode;
  mode: MeetingMode;
  onClose(): void;
  onSelect(mode: MeetingMode): void;
}) {
  const copy = getModeCopy(language);

  return (
    <div className="modeOverlay" role="presentation" onMouseDown={onClose}>
      <section
        className="modeDialog"
        aria-label={copy.title}
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modeDialogHeader">
          <h2>{copy.title}</h2>
          <button type="button" onClick={onClose}>
            {copy.close}
          </button>
        </div>
        <div className="modeChoices">
          <button
            className={mode === "simultaneous" ? "modeChoice active" : "modeChoice"}
            type="button"
            onClick={() => onSelect("simultaneous")}
          >
            <strong>{copy.simultaneousTitle}</strong>
            <span>{copy.simultaneousBody}</span>
          </button>
          <button
            className={mode === "face_to_face" ? "modeChoice active" : "modeChoice"}
            type="button"
            onClick={() => onSelect("face_to_face")}
          >
            <strong>{copy.faceTitle}</strong>
            <span>{copy.faceBody}</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function LanguagePicker({
  label,
  onChange,
  value,
  variant,
}: {
  label: string;
  onChange(value: LanguageCode): void;
  value: LanguageCode;
  variant: "top" | "dialog";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedLabel = getLanguageLabel(value);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={`languagePicker ${variant === "top" ? "topLanguage" : "dialogLanguage"}`} ref={rootRef}>
      <button
        className="languageButton"
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        title={selectedLabel}
        onClick={() => setOpen((current) => !current)}
      >
        <Globe2 size={variant === "top" ? 19 : 18} />
        <span className="languageButtonText">{selectedLabel}</span>
        <ChevronDown className="languageChevron" size={16} />
      </button>
      {open ? (
        <div className="languageMenu" role="listbox" aria-label={label}>
          {SUPPORTED_LANGUAGES.map((item) => {
            const selected = item.code === value;
            return (
              <button
                className={selected ? "languageOption selected" : "languageOption"}
                key={item.code}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(item.code);
                  setOpen(false);
                }}
              >
                <span>{item.label}</span>
                {selected ? <Check size={16} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function Waveform({ active, level }: { active: boolean; level: number }) {
  const bars = Array.from({ length: 28 }, (_, index) => {
    const phase = Math.sin(index * 0.7) * 0.28 + 0.72;
    const height = active ? 8 + Math.max(level, 0.08) * phase * 34 : 8 + phase * 4;
    return <span key={index} style={{ height }} />;
  });

  return <div className={active ? "waveform active" : "waveform"}>{bars}</div>;
}

function StatusPill({ status, t }: { status: ConnectionStatus; t: Translation }) {
  return <span className={`statusPill ${status}`}>{t.status[status]}</span>;
}

function createMeetingSocketUrl(roomId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/meetings/${encodeURIComponent(roomId)}`;
}

function formatSocketUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timer);
  }
}

function formatTime(value: string, language: LanguageCode): string {
  return new Intl.DateTimeFormat(language, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatLiveStatus(
  status: Extract<ServerMessage, { type: "live_status" }>,
  language: LanguageCode,
): string {
  const target = status.targetLanguage ? getLanguageLabel(status.targetLanguage) : "";
  const t = getTranslation(language);

  if (status.code === "live_session_starting") {
    return t.liveSessionStarting(target);
  }

  if (status.code === "live_session_ready") {
    return t.liveSessionReady(target);
  }

  return status.message;
}

function getTranslation(language: LanguageCode): Translation {
  return translations[language];
}

function getModeCopy(language: LanguageCode) {
  if (language === "zh-Hans") {
    return {
      title: "切换模式",
      close: "关闭",
      openModes: "切换房间模式",
      simultaneousTitle: "同声传译",
      simultaneousBody: "字幕和译音实时出现，适合多人连续交流。",
      faceTitle: "面对面模式",
      faceBody: "一次只允许一人录音，说完停止后统一播放翻译。",
      playing: "正在播放",
      playbackBusy: "正在播放翻译，播放结束后再说话。",
      speakerBusy: (name: string) => `${name} 正在发言，请稍后再说。`,
    };
  }

  return {
    title: "Switch mode",
    close: "Close",
    openModes: "Switch room mode",
    simultaneousTitle: "Live interpretation",
    simultaneousBody: "Captions and translated audio appear in real time.",
    faceTitle: "Face-to-face mode",
    faceBody: "Only one person records. Translation plays after they stop.",
    playing: "Playing",
    playbackBusy: "Translation is playing. Speak after playback ends.",
    speakerBusy: (name: string) => `${name} is speaking. Please wait.`,
  };
}

function mergeTranscriptEntry(
  current: TranscriptEntry[],
  message: Extract<ServerMessage, { type: "transcript" }>,
): TranscriptEntry[] {
  const timestamp = message.timestamp ?? new Date().toISOString();
  const incoming: TranscriptEntry = {
    id: message.id ?? crypto.randomUUID(),
    timestamp,
    speakerId: message.speakerId,
    speakerName: message.speakerName,
    sourceText: message.sourceText,
    translatedText: message.translatedText,
    language: message.language,
  };

  const last = current[current.length - 1];
  if (!last || !shouldMergeTranscript(last, incoming)) {
    return [...current, incoming].slice(-120);
  }

  return [
    ...current.slice(0, -1),
    {
      ...last,
      timestamp: incoming.timestamp,
      speakerName: incoming.speakerName ?? last.speakerName,
      sourceText: mergeTranscriptText(last.sourceText, incoming.sourceText),
      translatedText: mergeTranscriptText(last.translatedText, incoming.translatedText),
    },
  ].slice(-120);
}

function shouldMergeTranscript(last: TranscriptEntry, incoming: TranscriptEntry): boolean {
  if (last.speakerId !== incoming.speakerId) return false;
  if (last.language !== incoming.language) return false;

  const lastTime = Date.parse(last.timestamp);
  const incomingTime = Date.parse(incoming.timestamp);
  if (!Number.isFinite(lastTime) || !Number.isFinite(incomingTime)) return false;

  return incomingTime - lastTime <= transcriptMergeWindowMs;
}

function mergeTranscriptText(previous?: string, next?: string): string | undefined {
  if (!next) return previous;
  if (!previous) return next;

  const trimmedPrevious = previous.trim();
  const trimmedNext = next.trim();
  if (!trimmedNext) return previous;
  if (trimmedNext.startsWith(trimmedPrevious)) return trimmedNext;
  if (trimmedPrevious.endsWith(trimmedNext)) return trimmedPrevious;

  return `${trimmedPrevious}${needsTextJoinSpace(trimmedPrevious, trimmedNext) ? " " : ""}${trimmedNext}`;
}

function needsTextJoinSpace(previous: string, next: string): boolean {
  const previousChar = previous.at(-1) ?? "";
  const nextChar = next.at(0) ?? "";
  return /[A-Za-z0-9]/.test(previousChar) && /[A-Za-z0-9]/.test(nextChar);
}

function loadProfile(): { displayName: string; language: LanguageCode } {
  try {
    const profile = JSON.parse(localStorage.getItem(profileKey) ?? "{}") as {
      displayName?: string;
      language?: LanguageCode;
    };

    return {
      displayName: profile.displayName?.trim() || fallbackName(),
      language: isSupportedLanguage(profile.language) ? profile.language : DEFAULT_SOURCE_LANGUAGE,
    };
  } catch {
    return {
      displayName: fallbackName(),
      language: DEFAULT_SOURCE_LANGUAGE,
    };
  }
}

function fallbackName(): string {
  return `Guest ${Math.floor(Math.random() * 900 + 100)}`;
}

function saveProfile(profile: { displayName: string; language: LanguageCode }) {
  localStorage.setItem(profileKey, JSON.stringify(profile));
}
