"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { requestJson } from "@/lib/api";

/* -------------------------------------------------------------------------
   Kiosk languages: English (default) and Arabic.

   Text is written in English in the code and wrapped in t("..."). The
   Arabic below is keyed by that exact English text -- to change a
   translation, edit it here. Anything missing falls back to English.

   Arabic style notes (keep these when adding text):
   - Clear, polite Modern Standard Arabic, as used by UAE government and
     business services -- natural phrasing, not word-for-word.
   - UAE terms: "تسجيل الحضور" (check-in), "المنطقة الحرة" (free zone),
     "بصمة الوجه" (face ID).
   - Arabic numerals (٠١٢٣٤٥٦٧٨٩) for every number in Arabic mode -- the
     dictionary is written with 0-9 for easy editing and converted on
     display (see arabicDigits); "صباحاً / مساءً" instead of AM / PM.
   - "{name}"-style placeholders are filled in by t(text, { name }).

   Text that changes (event names and locations from the database, messages
   from the backend) can't be in this file. For those, the kiosk asks the
   backend (POST /api/kiosk/translate), which translates with AI once and
   saves the result -- see "Automatic translation" below. Until the Arabic
   arrives (a moment, the first time only) the English is shown.
   ------------------------------------------------------------------------- */

export type Lang = "en" | "ar";

const AR: Record<string, string> = {
  // ---- shared
  Back: "رجوع",
  Welcome: "أهلاً بك",
  "Check in": "تسجيل الحضور",
  Continue: "متابعة",
  Cancel: "إلغاء",
  Done: "تم",
  Close: "إغلاق",
  Send: "إرسال",
  Choose: "اختيار",
  Select: "اختر",
  "No options available": "لا توجد خيارات متاحة",
  Home: "الرئيسية",
  "Plan your visit": "خطّط لزيارتك",
  "AI voice assistant": "المساعد الصوتي الذكي",
  "Find a place": "ابحث عن مكان",
  "Start the AI voice assistant": "تشغيل المساعد الصوتي",
  "Stop the AI voice assistant": "إيقاف المساعد الصوتي",
  UAE: "الإمارات",
  "Ras Al Khaimah": "رأس الخيمة",
  "Innovation City": "مدينة الابتكار",
  // the slogan, in both wordings used in the project
  "Free zone of the future": "المنطقة الحرة للمستقبل",
  "The free zone of the future": "المنطقة الحرة للمستقبل",
  "The Free Zone of the Future": "المنطقة الحرة للمستقبل",
  "Innovation City · Free zone of the future": "مدينة الابتكار · المنطقة الحرة للمستقبل",
  "Innovation City · The free zone of the future": "مدينة الابتكار · المنطقة الحرة للمستقبل",
  "Returning to the start screen in {n}": "العودة إلى الشاشة الرئيسية خلال {n}",

  // ---- language + reach mode controls
  "Reach mode": "وضع سهولة الوصول",
  "Turn reach mode on": "تفعيل وضع سهولة الوصول",
  "Turn reach mode off": "إيقاف وضع سهولة الوصول",

  // ---- "are you still there?"
  "Are you still there?": "هل ما زلت هنا؟",
  "For your privacy, this screen will clear soon.\nTap below to keep going.":
    "حفاظاً على خصوصيتك، ستُمسح هذه الشاشة قريباً.\nاضغط أدناه للمتابعة.",
  "Start over": "البدء من جديد",
  "I'm still here": "ما زلت هنا",

  // ---- welcome screen
  "Welcome to\nInnovation City": "أهلاً بك في\nمدينة الابتكار",
  "Step closer to the screen\nto check in.": "اقترب من الشاشة\nلتسجيل حضورك.",
  "Let’s get you\nchecked in": "دعنا نسجّل\nحضورك",
  "We may already have your profile.\nLet’s take a quick look.":
    "قد يكون ملفك الشخصي لدينا بالفعل.\nلنتحقق من ذلك سريعاً.",

  // ---- how would you like to continue?
  "How would you like\nto continue?": "كيف تودّ\nالمتابعة؟",
  "Do any of these look like your profile?": "هل أحد هذه الملفات هو ملفك الشخصي؟",
  "None of these options — choose one of the options": "ليس أيٌّ منها؟ اختر أحد الخيارات التالية",
  "We couldn’t find your profile — choose one of the options": "لم نعثر على ملفك — اختر أحد الخيارات التالية",
  Match: "تطابق",
  "Continue as a visitor": "المتابعة كزائر",
  "Create new profile": "إنشاء ملف جديد",
  "Scan my face again": "إعادة مسح الوجه",
  "Report recognition issue": "الإبلاغ عن مشكلة في التعرّف",

  // ---- services
  "What brings you to\nInnovation City today?": "ما سبب زيارتك\nلمدينة الابتكار اليوم؟",
  "Talk to the assistant or select an option": "تحدّث مع المساعد أو اختر أحد الخيارات",
  Explore: "استكشف",
  "Discover the center's spaces.": "تعرّف على مرافق المركز.",
  Events: "الفعاليات",
  "Join an event or workshop.": "انضم إلى فعالية أو ورشة عمل.",
  "Meeting Rooms": "غرف الاجتماعات",
  "Book or find a meeting room.": "احجز غرفة اجتماعات أو اعثر عليها.",
  "Tik Tok Studio": "استوديو تيك توك",
  "TikTok Studio": "استوديو تيك توك",
  "Everything for TikTok Content": "كل ما تحتاجه لصناعة محتوى تيك توك",
  "Podcast Studio": "استوديو البودكاست",
  "Record, edit and stream with ease.": "سجّل وحرّر وابثّ بكل سهولة.",
  Support: "الدعم",
  "Get help with something else.": "احصل على المساعدة في أمر آخر.",

  // ---- profile lookup / registration
  "Find your profile": "ابحث عن ملفك الشخصي",
  "Enter your details so we can find your profile.": "أدخل بياناتك لنتمكن من العثور على ملفك.",
  "Full name": "الاسم الكامل",
  "Enter your full name": "أدخل اسمك الكامل",
  "Enter your name": "أدخل اسمك",
  "Mobile number": "رقم الهاتف المتحرك",
  "Email address": "البريد الإلكتروني",
  // left-to-right marks keep the number groups in order (٥٠ ١٢٣ ٤٥٦٧)
  "50 123 4567": "50\u200e 123\u200e 4567",
  "Don’t have a profile?": "ليس لديك ملف شخصي؟",
  "Create one": "أنشئ ملفاً",
  "New profile": "ملف جديد",
  "Create your profile": "أنشئ ملفك الشخصي",
  "Fill in your details, or tell the assistant.": "أدخل بياناتك، أو أخبر المساعد الصوتي بها.",
  "I am visiting as": "صفة الزيارة",
  Client: "عميل",
  Visitor: "زائر",
  KSA: "السعودية",
  US: "أمريكا",
  UK: "بريطانيا",
  Qatar: "قطر",
  Kuwait: "الكويت",
  Bahrain: "البحرين",
  Oman: "عُمان",

  // ---- face consent / scan
  "Faster check-in": "تسجيل حضور أسرع",
  "Recognise me\nnext time?": "هل تودّ أن نتعرّف عليك\nفي زيارتك القادمة؟",
  "A face scan lets the kiosk welcome you by name on your next visit.":
    "يتيح مسح الوجه أن نرحّب بك باسمك في زيارتك القادمة.",
  "I understand and consent to using facial recognition for future check-ins.":
    "أوافق على استخدام تقنية التعرّف على الوجه لتسجيل حضوري في الزيارات القادمة.",
  "Yes, enable face check-in": "نعم، فعّل تسجيل الحضور بالوجه",
  "Continue without face scan": "المتابعة دون مسح الوجه",
  "Face scan": "مسح الوجه",
  "Scan again": "إعادة المسح",
  "Face check-in": "تسجيل الحضور بالوجه",
  "Face registration": "تسجيل بصمة الوجه",
  "Opening the camera…": "جارٍ تشغيل الكاميرا…",
  "One moment": "لحظة من فضلك",
  "Place your face in the frame": "ضع وجهك داخل الإطار",
  "Look straight at the screen": "انظر مباشرةً إلى الشاشة",
  "Scanning your face": "جارٍ مسح وجهك",
  "Hold still": "ثبّت وجهك من فضلك",
  "Checking your profile…": "جارٍ التحقق من ملفك…",
  "This takes a few seconds": "يستغرق ذلك بضع ثوانٍ",
  "Profile found": "تم العثور على ملفك",
  "Welcome back!": "مرحباً بعودتك!",
  "No match found": "لم يتم العثور على تطابق",
  "Let's get you set up": "لنُكمل التسجيل معاً",
  "Couldn't scan": "تعذّر المسح",
  "Please try again or choose another option": "يرجى المحاولة مرة أخرى أو اختيار خيار آخر",
  "We'll save it for faster check-in next time": "سنحفظها لتسجيل حضور أسرع في المرة القادمة",
  "Saving your face…": "جارٍ حفظ بصمة وجهك…",
  "Almost done": "أوشكنا على الانتهاء",
  "Face saved": "تم حفظ بصمة الوجه",
  "Next time we'll welcome you by name": "سنرحّب بك باسمك في زيارتك القادمة",
  "We couldn't see your face clearly": "لم نتمكن من رؤية وجهك بوضوح",
  "Look straight at the screen, then try again": "انظر مباشرةً إلى الشاشة ثم حاول مرة أخرى",

  // ---- welcome back
  "Welcome back": "مرحباً بعودتك",
  "Good to see you,\n{name}": "سعداء برؤيتك،\n{name}",
  "Your booking today": "حجزك اليوم",
  "Your {n} bookings today": "عدد حجوزاتك اليوم: {n}",
  "Use Find a place for directions to your room.": "استخدم «ابحث عن مكان» لمعرفة الطريق إلى غرفتك.",
  "No bookings today": "لا توجد حجوزات اليوم",
  "Talk to the assistant or pick a service to get started.": "تحدّث مع المساعد أو اختر خدمة للبدء.",
  Finish: "إنهاء",
  "See services": "عرض الخدمات",
  "Other services": "خدمات أخرى",

  // ---- rooms
  Booking: "الحجز",
  "Choose your room": "اختر الغرفة",
  "Choose a room": "اختر غرفة",
  "Meeting Room 1": "غرفة الاجتماعات 1",
  "Meeting Room 2": "غرفة الاجتماعات 2",
  "Available now": "متاحة الآن",
  "Busy until {time}": "مشغولة حتى {time}",
  Closed: "مغلقة",
  "Up to 6 people": "حتى 6 أشخاص",
  "Up to 5 people": "حتى 5 أشخاص",
  "Large table": "طاولة كبيرة",
  "TV screen": "شاشة تلفاز",
  "Ground Floor": "الطابق الأرضي",
  "Free for customers (limited hours)": "مجاني للعملاء (لساعات محدودة)",
  "Close photo": "إغلاق الصورة",
  "View {room} photo full size": "عرض صورة {room} بالحجم الكامل",
  // descriptions from lib/kiosk-content.ts (centerRoomOptions)
  Offices: "المكاتب",
  "Business Center": "مركز الأعمال",
  "Private rooms for client meetings, advisory sessions, and partner discussions.":
    "غرف خاصة لاجتماعات العملاء والجلسات الاستشارية والنقاشات مع الشركاء.",
  "Workspace options for teams, founders, and Innovation City clients.":
    "مساحات عمل متنوعة للفرق ورواد الأعمال وعملاء مدينة الابتكار.",
  "Audio-ready studio for interviews, founder stories, and long-form recording.":
    "استوديو صوتي مجهّز للمقابلات وقصص المؤسسين والتسجيلات الطويلة.",
  "Short-form content studio set up for quick social media capture.":
    "استوديو مخصص للمحتوى القصير وتصوير مقاطع وسائل التواصل الاجتماعي بسرعة.",
  "CX-guided support for company setup, licenses, and free zone questions.":
    "دعم من فريق تجربة العملاء لتأسيس الشركات والتراخيص واستفسارات المنطقة الحرة.",

  // ---- booking form
  "Book a Meeting Room": "حجز غرفة اجتماعات",
  "Book the Podcast Studio": "حجز استوديو البودكاست",
  "Book TikTok Studio": "حجز استوديو تيك توك",
  Date: "التاريخ",
  Time: "الوقت",
  Duration: "المدة",
  Day: "اليوم",
  Month: "الشهر",
  Year: "السنة",
  Hour: "الساعة",
  Minute: "الدقيقة",
  "Choose a day": "اختر اليوم",
  "No dates available right now.": "لا توجد تواريخ متاحة حالياً.",
  "Choose a day first": "اختر اليوم أولاً",
  "No free times left on this day": "لا توجد أوقات متاحة في هذا اليوم",
  "Use the arrows to set a start time": "استخدم الأسهم لتحديد وقت البدء",
  "Starts at {time}": "يبدأ الساعة {time}",
  "Select a duration": "اختر المدة",
  "Select a time first": "اختر الوقت أولاً",
  "Reserve slot": "تأكيد الحجز",
  "{time} is already booked": "الساعة {time} محجوزة مسبقاً",
  "These times are free in {room}:": "الأوقات المتاحة في {room}:",
  "No other free times on this day.": "لا توجد أوقات أخرى متاحة في هذا اليوم.",
  "Choose a date, time and duration first.": "يرجى اختيار التاريخ والوقت والمدة أولاً.",
  "Please choose a date and time that has not already passed.": "يرجى اختيار تاريخ ووقت لم يمضيا بعد.",
  "That time is already booked. Please choose another time.": "هذا الوقت محجوز مسبقاً، يرجى اختيار وقت آخر.",
  "Could not submit booking.": "تعذّر إرسال الحجز.",

  // ---- quick registration
  "Almost there": "أوشكنا على الانتهاء",
  "One more step": "خطوة أخيرة",
  "Quick registration": "تسجيل سريع",
  "Your chosen time is saved — we just need your details to confirm the booking.":
    "تم حفظ الوقت الذي اخترته، نحتاج فقط إلى بياناتك لتأكيد الحجز.",
  "We just need your details to register you for the event.": "نحتاج فقط إلى بياناتك لتسجيلك في الفعالية.",
  "I'm new": "زائر جديد",
  "I have a profile": "لديّ ملف شخصي",
  "Confirm booking": "تأكيد الحجز",
  "Join event": "التسجيل في الفعالية",

  // ---- visitor pass
  "Visitor pass": "تصريح الزائر",
  "Booking confirmed": "تم تأكيد الحجز",
  "Registered for event": "تم تسجيلك في الفعالية",
  Name: "الاسم",
  Room: "الغرفة",
  Event: "الفعالية",
  "Tap Find a place any time for directions to your room.": "اضغط على «ابحث عن مكان» في أي وقت لمعرفة الطريق إلى غرفتك.",
  "Please be seated 10 minutes before the event starts.": "يرجى الحضور قبل بدء الفعالية بعشر دقائق.",
  "Book something else": "حجز آخر",

  // ---- events
  "Today’s events": "فعاليات اليوم",
  "No events are scheduled for today.": "لا توجد فعاليات مجدولة اليوم.",
  "Please be seated 10 minutes before {event} starts.": "يرجى الحضور قبل بدء {event} بعشر دقائق.",
  "Register for event": "التسجيل في الفعالية",

  // ---- floor map (Find a place)
  "Find your way": "اعثر على طريقك",
  "Ground floor map": "خريطة الطابق الأرضي",
  "You are here": "أنت هنا",
  "Meeting rooms": "غرف الاجتماعات",
  "Event Area": "منطقة الفعاليات",
  // text inside the meeting-room table drawings: "غرفة اجتماعات / رقم ١"
  Meeting: "غرفة اجتماعات",
  "Room {n}": "رقم {n}",
  Podcast: "البودكاست",
  TikTok: "تيك توك",
  Kitchen: "المطبخ",
  "Kitchen Closet": "المطبخ",
  "W.C": "دورة المياه",
  Reception: "الاستقبال",
  Entrance: "المدخل",
  // Hive offices: "مكتب" (office). Alternatives: "وحدة" (unit), "جناح" (suite).
  "Hive {n}": "مكتب {n}",
  Occupied: "مشغولة",
  Book: "احجز",
  "Follow the line on the map": "اتبع الخط على الخريطة",
  "Search, or tap any space on the map to see the way there": "ابحث، أو اضغط على أي مكان في الخريطة لمعرفة الطريق إليه",
  "Where do you want to go?": "إلى أين تريد الذهاب؟",
  "No matching place": "لا يوجد مكان مطابق",
  Clear: "مسح",

  // ---- Explore (about Innovation City)
  "About us": "من نحن",
  "Amenities & hours": "المرافق وساعات العمل",
  "Coming soon": "قريباً",
  "Ras Al Khaimah's dedicated hub for innovation-driven businesses": "مركز رأس الخيمة المخصص للأعمال القائمة على الابتكار",
  "Our vision": "رؤيتنا",
  "To be a global tech hub and the region's most successful premium free zone":
    "أن نكون مركزاً تقنياً عالمياً، والمنطقة الحرة المتميزة الأكثر نجاحاً في المنطقة",
  "Why set up here": "لماذا تؤسس أعمالك هنا",
  "AI-powered registry": "سجل تجاري مدعوم بالذكاء الاصطناعي",
  "Set up your company faster with smart registration": "أسّس شركتك بشكل أسرع عبر التسجيل الذكي",
  "On-chain licensing": "تراخيص موثّقة بتقنية البلوك تشين",
  "Secure, verifiable business licenses": "تراخيص تجارية آمنة وقابلة للتحقق",
  "Banking at the same time": "خدمات مصرفية في الوقت نفسه",
  "Open your bank account while you set up": "افتح حسابك المصرفي أثناء تأسيس شركتك",
  "Our mission": "مهمتنا",
  "Attract thousands of startups and entrepreneurs, and keep a true startup culture":
    "استقطاب آلاف الشركات الناشئة ورواد الأعمال، والحفاظ على ثقافة الشركات الناشئة",
  "Our values": "قيمنا",
  "Embrace the future, welcome global talent, and help them succeed": "نتبنّى المستقبل، ونرحّب بالمواهب العالمية، ونساعدها على النجاح",
  "Setup your company with us": "تحدّث معنا عن تأسيس شركتك",
  "Private offices for teams, founders and Innovation City clients": "مكاتب خاصة للفرق ورواد الأعمال وعملاء مدينة الابتكار",
  "available on the {floor}": "متاحة في {floor}",
  "5th Floor": "الطابق الخامس",
  "Every office includes": "يشمل كل مكتب",
  "4 work tables and chairs": "4 طاولات عمل وكراسي",
  "A movable drawer with a key, with storage underneath": "خزانة أدراج متحركة بقفل، مع مساحة تخزين أسفلها",
  "A shared table for storage": "طاولة مشتركة للتخزين",
  "Each office is leased to a different company, so furnishings can vary slightly. Ask the front desk about a specific office.":
    "كل مكتب مؤجَّر لشركة مختلفة، لذا قد يختلف الأثاث قليلاً. اسأل مكتب الاستقبال عن أي مكتب بعينه.",
  "Common area": "المنطقة المشتركة",
  "Comfortably fits up to {n} people": "تتسع براحة لما يصل إلى {n} شخصاً",
  "Ask about an office": "استفسر عن مكتب",
  "Working hours": "ساعات العمل",
  "Monday-Thursday": "من الإثنين إلى الخميس",
  Friday: "الجمعة",
  Saturday: "السبت",
  Sunday: "الأحد",
  "Saturday-Sunday": "السبت والأحد",
  "Free Wi-Fi": "واي فاي مجاني",
  "Ask reception for the password": "اطلب كلمة المرور من الاستقبال",
  "Prayer rooms": "المصليات",
  "On Floor R, via the dedicated elevators. Reception can show you the way": "في الطابق R عبر المصاعد المخصصة، ويمكن للاستقبال إرشادك",
  Cafeteria: "الكافتيريا",
  "On Floor R": "في الطابق R",
  "Fully accessible": "سهولة وصول كاملة",
  "Innovation City is fully wheelchair accessible": "مدينة الابتكار مهيأة بالكامل لمستخدمي الكراسي المتحركة",
  "Two new studios for creators are launching soon": "استوديوهان جديدان لصنّاع المحتوى قريباً",
  "Record interviews, founder stories and long-form audio": "سجّل المقابلات وقصص المؤسسين والمحتوى الصوتي الطويل",
  "Create short-form content and ads for social media": "اصنع محتوى قصيراً وإعلانات لوسائل التواصل الاجتماعي",
  "Launch offer": "عرض الإطلاق",
  "Free for Innovation City customers for a limited time after launch": "مجاناً لعملاء مدينة الابتكار لفترة محدودة بعد الإطلاق",

  // ---- Explore (list of spaces, previous version)
  "Everything in one place · tap to go": "كل المرافق في مكان واحد · اضغط للانتقال",
  "Up to 6 people · TV screen": "حتى 6 أشخاص · شاشة تلفاز",
  "Record interviews and founder stories": "سجّل المقابلات وقصص المؤسسين",
  "Short-form content for social media": "محتوى قصير لوسائل التواصل الاجتماعي",
  "Talks, workshops and launches": "محاضرات وورش عمل وإطلاقات",
  "Workspace for teams and founders": "مساحات عمل للفرق ورواد الأعمال",
  "See events": "عرض الفعاليات",
  "Ask us": "اسألنا",
  "Get help": "احصل على المساعدة",
  "Show {place} on the map": "عرض {place} على الخريطة",
  "No rooms free right now": "لا توجد غرف متاحة الآن",
  "1 room free now": "غرفة واحدة متاحة الآن",
  "{n} rooms free now": "{n} غرف متاحة الآن",

  // ---- explore the center
  "Explore the center": "استكشف المركز",
  "Ask Sky about any room on the floor, or browse below.": "اسأل «سكاي» عن أي غرفة في المركز، أو تصفّح القائمة أدناه.",
  "Ask Sky": "اسأل سكاي",

  // ---- support
  "How can we help?": "كيف يمكننا مساعدتك؟",
  "Reason for your visit": "سبب الزيارة",
  "Start your company": "تأسيس شركتك",
  "Free zone or company setup questions": "استفسارات حول المنطقة الحرة أو تأسيس الشركات",
  "Document creation or renewal": "إصدار المستندات أو تجديدها",
  "Notes for the CX team": "ملاحظات لفريق تجربة العملاء",
  "Anything we should know": "أي تفاصيل تودّ إخبارنا بها",
  "Send to CX team": "إرسال إلى فريق تجربة العملاء",

  // ---- report recognition issue
  "Recognition issue": "مشكلة في التعرّف",
  "We’re sorry\nabout that": "نعتذر عن\nذلك",
  "Something didn’t go right with recognising you. We’d love to hear what happened so we can fix it.":
    "حدث خطأ أثناء التعرّف عليك. يسعدنا أن تخبرنا بما حدث لنعمل على إصلاحه.",
  "Tell us what happened": "أخبرنا بما حدث",
  "For example: it showed someone else's profile, or it didn't find mine.":
    "مثال: ظهر ملف شخص آخر، أو لم يتم العثور على ملفي.",

  // ---- thank you
  "Thank you\nfor visiting": "شكراً\nلزيارتك",
  "Enjoy your time at Innovation City.": "نتمنى لك وقتاً ممتعاً في مدينة الابتكار.",
  "Thanks for\nletting us know": "شكراً\nلإبلاغنا",
  "Our team will look into it. We’re sorry for the trouble.": "سيتابع فريقنا الأمر، ونعتذر عن الإزعاج.",
  "Start over now": "البدء من جديد",

  // ---- Sky (voice dock)
  "Try saying": "جرّب أن تقول",
  "“Book Meeting Room 1 at 3 PM”": "«احجز غرفة الاجتماعات 1 الساعة 3 مساءً»",
  "“What’s on today?”": "«ما الفعاليات اليوم؟»",
  "“Where is the prayer room?”": "«أين المصلّى؟»",
  Mute: "كتم الصوت",
  Unmute: "إلغاء الكتم",
  End: "إنهاء",
  idle: "جاهز",
  "connecting…": "جارٍ الاتصال…",
  "loading knowledge base…": "جارٍ التحضير…",
  "minting ephemeral token…": "جارٍ الاتصال…",
  "connected - greeting…": "متصل — جارٍ الترحيب…",
  "assistant speaking…": "سكاي يتحدث…",
  "connected - your turn to talk": "تفضّل بالحديث",
  "connected - just start talking": "تفضّل بالحديث",
  "interrupted - listening…": "أستمع إليك…",
  muted: "الميكروفون مكتوم",
  "muted - assistant done talking": "الميكروفون مكتوم",
  "conversation ended": "انتهت المحادثة",
  disconnected: "تم قطع الاتصال",
  "error - check browser console": "حدث خطأ",
  "failed to connect - check browser console": "تعذّر الاتصال",
  "registered — capturing your photo, please look at the camera…": "تم التسجيل — يرجى النظر إلى الكاميرا…",

  // ---- messages shown by the kiosk itself (server messages stay as sent)
  "Face scan failed.": "تعذّر مسح الوجه.",
  "Could not enroll your face.": "تعذّر حفظ بصمة الوجه.",
  "Profile not found.": "لم يتم العثور على الملف الشخصي.",
  "Could not create profile.": "تعذّر إنشاء الملف الشخصي.",
  "Could not save consent.": "تعذّر حفظ الموافقة.",
  "Camera access is not available in this browser.": "الكاميرا غير متاحة في هذا المتصفح.",
  "Camera unavailable.": "الكاميرا غير متاحة.",
  "Could not prepare face capture.": "تعذّر تجهيز الكاميرا.",
  "Could not continue.": "تعذّر المتابعة.",
  "Could not load events.": "تعذّر تحميل الفعاليات.",
  "Could not select event.": "تعذّر التسجيل في الفعالية.",
  "Could not send your message. Please try again.": "تعذّر إرسال رسالتك، يرجى المحاولة مرة أخرى.",
  "Could not submit request.": "تعذّر إرسال الطلب.",
};

/* ---- Numbers ---- */

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** 0-9 -> ٠-٩ and % -> ٪ (Arabic mode only). */
export function arabicDigits(text: string): string {
  return text.replace(/[0-9]/g, (d) => ARABIC_DIGITS[Number(d)]).replace(/%/g, "٪");
}

/** Any number for display: Arabic numerals in Arabic, unchanged in English. */
export function localDigits(lang: Lang, value: string | number): string {
  return lang === "ar" ? arabicDigits(String(value)) : String(value);
}

/** ٠-٩ (or Persian ۰-۹) typed on an Arabic keyboard -> 0-9, for saving. */
export function toLatinDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
}

/* ---- Automatic translation (changing text) ---- */

const autoCache = new Map<string, string>(); // english -> arabic, from the backend
const pending = new Set<string>(); // waiting to be sent
const inFlight = new Set<string>();
const failedAt = new Map<string, number>(); // retry a failed text after a while
const RETRY_AFTER_MS = 2 * 60_000;
const listeners = new Set<() => void>();
let version = 0;
let flushTimer = 0;

/** Same rules as the backend: skip numbers, codes, emails and Arabic text. */
function wantsAutoTranslation(text: string): boolean {
  if (!text || text.length > 1000) return false;
  if (/[\u0600-\u06FF]/.test(text)) return false;
  if (text.includes("@") && !text.includes(" ")) return false;
  return /[A-Za-z]{2,}/.test(text);
}

function notify() {
  version += 1;
  listeners.forEach((listener) => listener());
}

async function flush() {
  flushTimer = 0;
  const batch = Array.from(pending).slice(0, 50);
  batch.forEach((text) => {
    pending.delete(text);
    inFlight.add(text);
  });
  if (pending.size > 0) flushTimer = window.setTimeout(flush, 50);
  if (batch.length === 0) return;
  try {
    const data = await requestJson<{ translations: Record<string, string> }>("/api/kiosk/translate", {
      method: "POST",
      body: JSON.stringify({ texts: batch, target_lang: "ar" }),
    });
    const translations = data?.translations ?? {};
    batch.forEach((text) => {
      if (translations[text]) autoCache.set(text, translations[text]);
      else failedAt.set(text, Date.now());
    });
  } catch {
    batch.forEach((text) => failedAt.set(text, Date.now())); // keep English for now
  } finally {
    batch.forEach((text) => inFlight.delete(text));
    notify();
  }
}

function requestAutoTranslation(text: string) {
  if (typeof window === "undefined" || pending.has(text) || inFlight.has(text)) return;
  const failed = failedAt.get(text);
  if (failed && Date.now() - failed < RETRY_AFTER_MS) return;
  pending.add(text);
  // Collect everything a screen needs for a moment, then ask once.
  if (!flushTimer) flushTimer = window.setTimeout(flush, 60);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-render when new automatic translations arrive. */
export function useTranslationVersion() {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

/**
 * Kiosk style: no full stop at the end of a sentence (or of a line in
 * multi-line text). Full stops between sentences, "…", "?" and "!" stay.
 */
function withoutEndingFullStop(text: string): string {
  return text.replace(/\.(?=[ \t]*(\n|$))/g, "");
}

/** Arabic from the translation file only (never asks the backend); null if absent. */
export function arabicFromFile(text: string): string | null {
  return AR[text] ?? null;
}

/** Translate English UI text. Unknown text is returned as-is (English). */
export function translate(lang: Lang, text: string, vars?: Record<string, string | number>): string {
  let out = text;
  if (lang === "ar") {
    if (AR[text] !== undefined) out = AR[text];
    else if (autoCache.has(text)) out = autoCache.get(text) as string;
    else if (wantsAutoTranslation(text)) requestAutoTranslation(text);
  }
  if (vars) {
    for (const [key, value] of Object.entries(vars)) out = out.split(`{${key}}`).join(String(value));
  }
  out = withoutEndingFullStop(out);
  return lang === "ar" ? arabicDigits(out) : out;
}

/* ---- dates and times ---- */

const LOCALE: Record<Lang, string> = { en: "en-GB", ar: "ar-AE-u-nu-arab" }; // Arabic numerals in Arabic

/** "14:00" -> "2:00 PM" / "2:00 مساءً" */
export function formatClock(lang: Lang, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const time = `${h % 12 || 12}:${String(m).padStart(2, "0")}`;
  if (lang === "ar") return `${arabicDigits(time)} ${h < 12 ? "صباحاً" : "مساءً"}`;
  return `${time} ${h < 12 ? "AM" : "PM"}`;
}

/** AM/PM button labels. */
export function periodLabel(lang: Lang, period: "AM" | "PM"): string {
  if (lang !== "ar") return period;
  return period === "AM" ? "صباحاً" : "مساءً";
}

/** "2026-10-06" -> "Tue, 6 Oct 2026" / "الثلاثاء، 6 أكتوبر 2026" */
export function formatDay(lang: Lang, isoDate: string, style: "short" | "long" = "short"): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(LOCALE[lang], {
    weekday: style === "long" ? "long" : "short",
    day: "numeric",
    month: style === "long" ? "long" : lang === "ar" ? "long" : "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Month name for the date picker column. */
export function monthName(lang: Lang, month: number): string {
  return new Date(Date.UTC(2026, month - 1, 1)).toLocaleDateString(LOCALE[lang], {
    month: lang === "ar" ? "long" : "short",
    timeZone: "UTC",
  });
}

/** Header: weekday and "6 October" in the kiosk's time zone. */
export function headerDate(lang: Lang, now: Date): { day: string; date: string } {
  const timeZone = "Asia/Dubai";
  return {
    day: now.toLocaleDateString(LOCALE[lang], { weekday: "long", timeZone }),
    date: now.toLocaleDateString(LOCALE[lang], { month: "long", day: "numeric", timeZone }),
  };
}

/** 30 -> "30 minutes" / "30 دقيقة"; 90 -> "1.5 hours" / "ساعة ونصف". */
export function durationLabel(lang: Lang, minutes: number, englishLabel?: string): string {
  if (lang !== "ar") return englishLabel ?? (minutes < 60 ? `${minutes} min` : `${minutes / 60} hr${minutes > 60 ? "s" : ""}`);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  let label: string;
  if (hours === 0) label = `${minutes} دقيقة`;
  else {
    const hourText = hours === 1 ? "ساعة" : hours === 2 ? "ساعتان" : `${hours} ساعات`;
    label =
      rest === 0 ? hourText : rest === 30 ? `${hourText} ونصف` : rest === 15 ? `${hourText} وربع` : `${hourText} و${rest} دقيقة`;
  }
  return arabicDigits(label);
}

/* ---- React ---- */

const LangContext = createContext<{ lang: Lang; version: number }>({ lang: "en", version: 0 });

/** Provides the language; re-renders the kiosk when automatic translations arrive. */
export function LangProvider({ value, children }: { value: Lang; children: ReactNode }) {
  const current = useTranslationVersion();
  return <LangContext.Provider value={{ lang: value, version: current }}>{children}</LangContext.Provider>;
}

export function useLang() {
  const { lang } = useContext(LangContext);
  return {
    lang,
    isAr: lang === "ar",
    t: (text: string, vars?: Record<string, string | number>) => translate(lang, text, vars),
  };
}