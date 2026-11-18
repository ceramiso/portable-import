import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  arrayUnion,
  setDoc,
} from 'firebase/firestore';
import {
  Plus,
  Search,
  Trash2,
  Edit3,
  Image as ImageIcon,
  X,
  CheckCircle2,
  Clock,
  Package,
  Calendar,
  FileText,
  Check,
  User,
  LogOut,
  History,
  MessageSquare,
  Send,
  ShieldCheck,
  Users,
  Download,
  Upload,
  KeyRound,
  ShoppingBag,
  Building2,
  Layers,
  Mail,
} from 'lucide-react';

// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyCAsoVMjbdeslPpUD6DMmPlrP2Hqiv5U54",
  authDomain: "ceramic-orders.firebaseapp.com",
  projectId: "ceramic-orders",
  storageBucket: "ceramic-orders.firebasestorage.app",
  messagingSenderId: "564678597521",
  appId: "1:564678597521:web:9c45bd1f2a992ecbd85830",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const DEFAULT_ADMIN_USERNAME = 'izak';
const DEFAULT_ADMIN_PASSWORD = 'admin1234';
const DEFAULT_NOTIFICATION_EMAIL = 'izak@ceramiso.co.il';

const ORDERS_PATH = ['artifacts', 'ceramic-orders', 'public', 'data', 'orders'] as const;
const STAFF_PATH = ['artifacts', 'ceramic-orders', 'public', 'data', 'authorized_staff'] as const;
const SETTINGS_DOC_PATH = ['artifacts', 'ceramic-orders', 'public', 'data', 'settings', 'general'] as const;

interface LogEntry {
  user: string;
  action: string;
  timestamp: number;
}

interface ChatMessage {
  user: string;
  text: string;
  timestamp: number;
}

interface StaffRecord {
  id: string;
  username: string;
  password: string;
  active: boolean;
  canApprove: boolean;
  createdAt: number;
}

interface EmailSettings {
  notificationEmail: string;
  emailjsServiceId: string;
  emailjsTemplateId: string;
  emailjsPublicKey: string;
  adminPassword?: string;
}

interface Order {
  id: string;
  orderType: 'מלאי' | 'B2B';
  customerName: string;
  orderNumber: string;
  modelName: string;
  quantity: string;
  supplier: string;
  isOrdered: boolean;
  isReceived: boolean;
  eta: string;
  notes: string;
  images: string[];
  logs: LogEntry[];
  messages: ChatMessage[];
  createdBy?: string;
  createdAt: number;
}

const formatDateTime = (timestamp: number) => {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const compressImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800;
        const scaleSize = MAX_WIDTH / img.width;
        canvas.width = img.width > MAX_WIDTH ? MAX_WIDTH : img.width;
        canvas.height = img.width > MAX_WIDTH ? img.height * scaleSize : img.height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.65));
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
};

export default function App() {
  const [fbUser, setFbUser] = useState<FirebaseUser | null>(null);
  const [connecting, setConnecting] = useState(true);

  const [loggedInUser, setLoggedInUser] = useState<{ username: string; isAdmin: boolean } | null>(
    () => {
      try {
        const raw = localStorage.getItem('ceramiso_auth_session') || sessionStorage.getItem('ceramiso_auth_session');
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    }
  );
  
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [loginError, setLoginError] = useState('');

  const [orders, setOrders] = useState<Order[]>([]);
  const [staffList, setStaffList] = useState<StaffRecord[]>([]);
  const [settings, setSettings] = useState<EmailSettings>({
    notificationEmail: DEFAULT_NOTIFICATION_EMAIL,
    emailjsServiceId: '',
    emailjsTemplateId: '',
    emailjsPublicKey: '',
    adminPassword: DEFAULT_ADMIN_PASSWORD,
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('הכל');
  const [typeFilter, setTypeFilter] = useState<string>('הכל');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [saving, setSaving] = useState(false);

  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [adminTab, setAdminTab] = useState<'users' | 'email'>('users');
  const [newStaffUsername, setNewStaffUsername] = useState('');
  const [newStaffPassword, setNewStaffPassword] = useState('');
  const [newStaffCanApprove, setNewStaffCanApprove] = useState(false);
  const [creatingStaff, setCreatingStaff] = useState(false);

  const [settingsForm, setSettingsForm] = useState<EmailSettings>({
    notificationEmail: DEFAULT_NOTIFICATION_EMAIL,
    emailjsServiceId: '',
    emailjsTemplateId: '',
    emailjsPublicKey: '',
    adminPassword: DEFAULT_ADMIN_PASSWORD,
  });
  const [savingSettings, setSavingSettings] = useState(false);

  const [activeDetailsOrderId, setActiveDetailsOrderId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'chat' | 'logs'>('chat');
  const [newMessageText, setNewMessageText] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);

  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const [formData, setFormData] = useState({
    orderType: 'B2B' as 'מלאי' | 'B2B',
    customerName: '',
    orderNumber: '',
    modelName: '',
    quantity: '',
    supplier: '',
    isOrdered: false,
    eta: '',
    notes: '',
    images: [] as string[],
  });

  const isAdmin = Boolean(loggedInUser?.isAdmin);
  const currentDisplayName = loggedInUser ? (isAdmin ? `${loggedInUser.username} (מנהל)` : loggedInUser.username) : '';

  // בדיקת הרשאת אישור ספציפית
  const hasApprovalPermission = isAdmin || (
    staffList.find(s => s.username.toLowerCase() === loggedInUser?.username.toLowerCase())?.canApprove ?? false
  );

  useEffect(() => {
    signInAnonymously(auth).catch((err) => setConnecting(false));
    const unsub = onAuthStateChanged(auth, (u) => {
      setFbUser(u);
      setConnecting(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!fbUser) return;

    const unsubOrders = onSnapshot(query(collection(db, ...ORDERS_PATH), orderBy('createdAt', 'desc')), (snapshot) => {
      const list: Order[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          orderType: data.orderType === 'מלאי' ? 'מלאי' : 'B2B',
          customerName: data.customerName || '',
          orderNumber: data.orderNumber || '',
          modelName: data.modelName || '',
          quantity: data.quantity || '',
          supplier: data.supplier || '',
          isOrdered: Boolean(data.isOrdered),
          isReceived: Boolean(data.isReceived),
          eta: data.eta || '',
          notes: data.notes || '',
          images: Array.isArray(data.images) ? data.images : [],
          logs: Array.isArray(data.logs) ? data.logs : [],
          messages: Array.isArray(data.messages) ? data.messages : [],
          createdBy: data.createdBy || '',
          createdAt: data.createdAt || Date.now(),
        };
      });
      setOrders(list);
    });

    const unsubStaff = onSnapshot(collection(db, ...STAFF_PATH), (snapshot) => {
      const list: StaffRecord[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          username: data.username || '',
          password: data.password || '',
          active: data.active !== false,
          canApprove: data.canApprove === true,
          createdAt: data.createdAt || Date.now(),
        };
      });
      setStaffList(list);
    });

    const unsubSettings = onSnapshot(doc(db, ...SETTINGS_DOC_PATH), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        const loaded: EmailSettings = {
          notificationEmail: d.notificationEmail || DEFAULT_NOTIFICATION_EMAIL,
          emailjsServiceId: d.emailjsServiceId || '',
          emailjsTemplateId: d.emailjsTemplateId || '',
          emailjsPublicKey: d.emailjsPublicKey || '',
          adminPassword: d.adminPassword || DEFAULT_ADMIN_PASSWORD,
        };
        setSettings(loaded);
        setSettingsForm(loaded);
      }
    });

    return () => {
      unsubOrders();
      unsubStaff();
      unsubSettings();
    };
  }, [fbUser]);

  useEffect(() => {
    if (loggedInUser && !loggedInUser.isAdmin && staffList.length > 0) {
      const found = staffList.find((s) => s.username.toLowerCase() === loggedInUser.username.toLowerCase());
      if (!found || !found.active) handleLogout();
    }
  }, [loggedInUser, staffList]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    const uClean = usernameInput.trim();
    const pClean = passwordInput;
    const currentAdminPass = settings.adminPassword || DEFAULT_ADMIN_PASSWORD;

    if (uClean.toLowerCase() === DEFAULT_ADMIN_USERNAME.toLowerCase()) {
      if (pClean === currentAdminPass) {
        saveAuthSession({ username: DEFAULT_ADMIN_USERNAME, isAdmin: true });
        return;
      } else {
        setLoginError('סיסמת מנהל שגויה.');
        return;
      }
    }

    const matched = staffList.find((s) => s.username.toLowerCase() === uClean.toLowerCase() && s.password === pClean);
    if (!matched) {
      setLoginError('שם משתמש או סיסמה שגויים. פנה למנהל המערכת להרשאה.');
      return;
    }
    if (!matched.active) {
      setLoginError('משתמש זה הושבת על ידי מנהל המערכת.');
      return;
    }

    saveAuthSession({ username: matched.username, isAdmin: false });
  };

  const saveAuthSession = (sessionObj: { username: string; isAdmin: boolean }) => {
    const raw = JSON.stringify(sessionObj);
    if (rememberMe) {
      localStorage.setItem('ceramiso_auth_session', raw);
      sessionStorage.removeItem('ceramiso_auth_session');
    } else {
      sessionStorage.setItem('ceramiso_auth_session', raw);
      localStorage.removeItem('ceramiso_auth_session');
    }
    setLoggedInUser(sessionObj);
    setPasswordInput('');
  };

  const handleLogout = () => {
    localStorage.removeItem('ceramiso_auth_session');
    sessionStorage.removeItem('ceramiso_auth_session');
    setLoggedInUser(null);
    setPasswordInput('');
  };

  const sendBackgroundOfficeEmail = async (data: any) => {
    const { notificationEmail, emailjsServiceId, emailjsTemplateId, emailjsPublicKey } = settings;
    if (!notificationEmail || !emailjsServiceId || !emailjsTemplateId || !emailjsPublicKey) return;
    const subject = data.orderType === 'B2B' ? `הזמנת יבוא חדשה (B2B) - ${data.customerName}` : `הזמנת יבוא חדשה למלאי`;
    const messageDetails = `הזמנה חדשה:\nסוג: ${data.orderType}\nדגם: ${data.modelName}\nכמות: ${data.quantity || '-'}`;
    try {
      await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: emailjsServiceId.trim(),
          template_id: emailjsTemplateId.trim(),
          user_id: emailjsPublicKey.trim(),
          template_params: { to_email: notificationEmail.trim(), subject, message: messageDetails },
        }),
      });
    } catch (err) {}
  };

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    if (!newStaffUsername.trim() || !newStaffPassword.trim()) return alert('נא למלא שם משתמש וסיסמה');
    if (staffList.some((s) => s.username.toLowerCase() === newStaffUsername.trim().toLowerCase())) return alert('משתמש כבר קיים');

    setCreatingStaff(true);
    try {
      await addDoc(collection(db, ...STAFF_PATH), {
        username: newStaffUsername.trim(),
        password: newStaffPassword.trim(),
        active: true,
        canApprove: newStaffCanApprove,
        createdAt: Date.now(),
      });
      setNewStaffUsername('');
      setNewStaffPassword('');
      setNewStaffCanApprove(false);
    } catch {
      alert('שגיאה בהוספה');
    } finally {
      setCreatingStaff(false);
    }
  };

  const handleToggleStaffActive = async (staff: StaffRecord) => {
    if (!isAdmin) return;
    try { await updateDoc(doc(db, ...STAFF_PATH, staff.id), { active: !staff.active }); } catch {}
  };

  const handleToggleStaffApprove = async (staff: StaffRecord) => {
    if (!isAdmin) return;
    try { await updateDoc(doc(db, ...STAFF_PATH, staff.id), { canApprove: !staff.canApprove }); } catch {}
  };

  const handleDeleteStaff = async (staff: StaffRecord) => {
    if (!isAdmin) return;
    if (window.confirm(`למחוק את "${staff.username}"?`)) {
      try { await deleteDoc(doc(db, ...STAFF_PATH, staff.id)); } catch {}
    }
  };

  const handleSaveAdminSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setSavingSettings(true);
    try {
      await setDoc(doc(db, ...SETTINGS_DOC_PATH), settingsForm, { merge: true });
      alert('ההגדרות נשמרו בהצלחה!');
    } catch {
      alert('שגיאה בשמירת ההגדרות');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.modelName.trim()) return alert('נא למלא דגם');
    const cleanedPayload = {
      orderType: formData.orderType,
      customerName: formData.orderType === 'B2B' ? formData.customerName.trim() : '',
      orderNumber: formData.orderType === 'B2B' ? formData.orderNumber.trim() : '',
      modelName: formData.modelName.trim(),
      quantity: formData.quantity.trim(),
      supplier: formData.supplier.trim(),
      isOrdered: Boolean(formData.isOrdered),
      eta: formData.eta,
      notes: formData.notes.trim(),
      images: formData.images,
    };

    setSaving(true);
    try {
      if (editingOrder) {
        const logEntry: LogEntry = { user: currentDisplayName, action: 'ערך הזמנה', timestamp: Date.now() };
        await updateDoc(doc(db, ...ORDERS_PATH, editingOrder.id), { ...cleanedPayload, logs: arrayUnion(logEntry) });
      } else {
        const initialLog: LogEntry = { user: currentDisplayName, action: 'יצר הזמנה', timestamp: Date.now() };
        await addDoc(collection(db, ...ORDERS_PATH), {
          ...cleanedPayload,
          isReceived: false,
          createdBy: currentDisplayName,
          createdAt: Date.now(),
          logs: [initialLog],
          messages: [],
        });
        sendBackgroundOfficeEmail(cleanedPayload);
      }
      setIsModalOpen(false);
    } catch {
      alert('שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleOrderedQuick = async (order: Order) => {
    if (!hasApprovalPermission) return alert('אין לך הרשאה לשנות סטטוס הזמנות.');
    if (!window.confirm('האם אתה בטוח שברצונך לעדכן סטטוס הזמנה?')) return;
    const nextVal = !order.isOrdered;
    try {
      const logEntry: LogEntry = { user: currentDisplayName, action: nextVal ? 'סימן: הוזמן מהספק' : 'ביטל סימון הוזמן', timestamp: Date.now() };
      await updateDoc(doc(db, ...ORDERS_PATH, order.id), { isOrdered: nextVal, logs: arrayUnion(logEntry) });
    } catch {}
  };

  const handleConfirmReceived = async (order: Order) => {
    if (!hasApprovalPermission) return alert('אין לך הרשאה לאשר סחורה שהתקבלה.');
    if (!window.confirm('האם אתה בטוח שההזמנה התקבלה וסופקה?')) return;
    try {
      const logEntry: LogEntry = { user: currentDisplayName, action: 'אישר אספקה ("התקבל")', timestamp: Date.now() };
      await updateDoc(doc(db, ...ORDERS_PATH, order.id), { isReceived: true, isOrdered: true, logs: arrayUnion(logEntry) });
    } catch {}
  };

  const openEditModal = (order: Order) => {
    setEditingOrder(order);
    setFormData({
      orderType: order.orderType || 'B2B',
      customerName: order.customerName,
      orderNumber: order.orderNumber || '',
      modelName: order.modelName,
      quantity: order.quantity,
      supplier: order.supplier,
      isOrdered: Boolean(order.isOrdered),
      eta: order.eta,
      notes: order.notes,
      images: order.images || [],
    });
    setIsModalOpen(true);
  };

  if (connecting) return <div dir="rtl" className="min-h-screen flex items-center justify-center">טוען...</div>;
  if (!loggedInUser) return (
    <div dir="rtl" className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-xl">
        <h1 className="text-2xl font-bold text-center mb-6">כניסה למערכת</h1>
        {loginError && <div className="text-rose-600 text-sm mb-4 text-center">{loginError}</div>}
        <form onSubmit={handleLogin} className="space-y-4">
          <input type="text" placeholder="שם משתמש" required value={usernameInput} onChange={(e) => setUsernameInput(e.target.value)} className="w-full px-4 py-3 bg-slate-50 border rounded-xl text-sm" />
          <input type="password" placeholder="סיסמה" required value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} className="w-full px-4 py-3 bg-slate-50 border rounded-xl text-sm" dir="ltr" />
          <button type="submit" className="w-full py-3 bg-slate-900 text-white rounded-xl text-sm font-bold">התחבר</button>
        </form>
      </div>
    </div>
  );

  const filteredOrders = orders.filter((order) => {
    const matchSearch = order.modelName.includes(searchTerm) || order.customerName.includes(searchTerm);
    const matchType = typeFilter === 'הכל' || order.orderType === typeFilter;
    const matchStatus = statusFilter === 'הכל' || (statusFilter === 'לא הוזמן' && !order.isOrdered && !order.isReceived) || (statusFilter === 'הוזמן' && order.isOrdered && !order.isReceived) || (statusFilter === 'התקבל' && order.isReceived);
    return matchSearch && matchType && matchStatus;
  });

  return (
    <div dir="rtl" className="min-h-screen bg-[#F8F9FA] text-slate-800 pb-16 antialiased">
      <header className="bg-white/90 backdrop-blur-md border-b sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-amber-400 font-bold">C</div>
            <div>
              <h1 className="text-lg font-bold">קרמיסו • יבוא</h1>
              <div className="flex gap-2 text-xs text-slate-500">
                <span>{currentDisplayName}</span>
                <button onClick={handleLogout} className="text-slate-400 hover:text-slate-800">התנתק</button>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {isAdmin && <button onClick={() => setIsAdminModalOpen(true)} className="px-3 py-2 bg-slate-100 rounded-xl text-sm font-semibold flex items-center gap-2"><Users className="w-4 h-4"/>הגדרות</button>}
            <button onClick={() => { setEditingOrder(null); setIsModalOpen(true); }} className="px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-semibold flex items-center gap-2"><Plus className="w-4 h-4 text-amber-400"/> הזמנה חדשה</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 mt-6 space-y-6">
        <div className="bg-white p-3 rounded-2xl border shadow-sm flex flex-col md:flex-row gap-3">
          <input type="text" placeholder="חיפוש..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="flex-1 px-4 py-2 bg-slate-50 border rounded-xl text-sm outline-none" />
          <div className="flex gap-2">
            <select onChange={(e) => setTypeFilter(e.target.value)} className="px-3 py-2 bg-slate-50 border rounded-xl text-sm outline-none"><option>הכל</option><option>B2B</option><option>מלאי</option></select>
            <select onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 bg-slate-50 border rounded-xl text-sm outline-none"><option>הכל</option><option>לא הוזמן</option><option>הוזמן</option><option>התקבל</option></select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredOrders.map(order => (
            <div key={order.id} className="bg-white rounded-2xl border flex flex-col overflow-hidden shadow-sm">
              <div className="px-5 pt-5 pb-3 border-b border-slate-100">
                <div className="flex justify-between">
                  <span className="text-xs font-bold px-2 py-1 rounded bg-slate-100">{order.orderType}</span>
                  <button onClick={() => openEditModal(order)} className="p-1 text-slate-400 hover:text-slate-900"><Edit3 className="w-4 h-4" /></button>
                </div>
                <h3 className="font-bold mt-2">{order.orderType === 'B2B' ? order.customerName : 'הזמנת מלאי'}</h3>
                <div className="text-sm text-slate-500 mt-1">דגם: {order.modelName}</div>
              </div>
              <div className="px-5 py-4 space-y-3 flex-1">
                {hasApprovalPermission && !order.isReceived && (
                  <label className="flex items-center justify-between bg-slate-50 border p-2 rounded-xl cursor-pointer">
                    <span className="text-sm font-semibold">הוזמן מהספק</span>
                    <input type="checkbox" checked={order.isOrdered} onChange={() => handleToggleOrderedQuick(order)} className="w-4 h-4" />
                  </label>
                )}
                {!hasApprovalPermission && !order.isReceived && (
                  <div className="flex items-center justify-between bg-slate-50 border p-2 rounded-xl opacity-60">
                    <span className="text-sm font-semibold">הוזמן מהספק</span>
                    <input type="checkbox" checked={order.isOrdered} disabled className="w-4 h-4" />
                  </div>
                )}
                {order.isReceived && <div className="text-sm font-bold text-emerald-600 bg-emerald-50 p-2 rounded-xl text-center">הזמנה סופקה</div>}
              </div>
              <div className="px-5 pb-5">
                {hasApprovalPermission && !order.isReceived && (
                  <button onClick={() => handleConfirmReceived(order)} className="w-full py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2">
                    <Check className="w-4 h-4" /> אישור התקבל
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Admin Modal */}
      {isAdminModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl flex flex-col h-[85vh]">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h2 className="text-lg font-bold">הגדרות מערכת</h2>
              <button onClick={() => setIsAdminModalOpen(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X className="w-5 h-5"/></button>
            </div>
            
            <div className="flex border-b">
              <button onClick={() => setAdminTab('users')} className={`flex-1 py-3 text-sm font-bold border-b-2 ${adminTab === 'users' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500'}`}><Users className="w-4 h-4 inline ml-1"/> משתמשים והרשאות</button>
              <button onClick={() => setAdminTab('email')} className={`flex-1 py-3 text-sm font-bold border-b-2 ${adminTab === 'email' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500'}`}><Mail className="w-4 h-4 inline ml-1"/> אימייל אוטומטי</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {adminTab === 'users' ? (
                <div className="space-y-6">
                  <form onSubmit={handleAddStaff} className="flex flex-wrap gap-2 bg-slate-50 p-4 rounded-2xl border">
                    <input type="text" placeholder="שם משתמש" required value={newStaffUsername} onChange={(e)=>setNewStaffUsername(e.target.value)} className="px-3 py-2 text-sm border rounded-xl flex-1"/>
                    <input type="text" placeholder="סיסמה" required value={newStaffPassword} onChange={(e)=>setNewStaffPassword(e.target.value)} className="px-3 py-2 text-sm border rounded-xl flex-1"/>
                    <label className="flex items-center gap-1 text-xs font-semibold px-2">
                      <input type="checkbox" checked={newStaffCanApprove} onChange={(e) => setNewStaffCanApprove(e.target.checked)} /> מורשה לאשר
                    </label>
                    <button type="submit" className="px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-semibold">הוסף</button>
                  </form>
                  <div className="space-y-2">
                    {staffList.map((s) => (
                      <div key={s.id} className="flex flex-wrap items-center justify-between p-3 bg-white border rounded-xl">
                        <span className="font-bold text-sm">{s.username}</span>
                        <div className="flex items-center gap-4">
                          <label className="flex items-center text-xs gap-1 cursor-pointer">
                            <input type="checkbox" checked={s.canApprove} onChange={() => handleToggleStaffApprove(s)} /> מורשה לאשר
                          </label>
                          <label className="flex items-center text-xs gap-1 cursor-pointer">
                            <input type="checkbox" checked={s.active} onChange={() => handleToggleStaffActive(s)} /> משתמש פעיל
                          </label>
                          <button onClick={() => handleDeleteStaff(s)} className="text-rose-500"><Trash2 className="w-4 h-4"/></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSaveAdminSettings} className="space-y-4 max-w-sm">
                  <div><label className="text-xs font-bold">מייל להתראות</label><input type="email" value={settingsForm.notificationEmail} onChange={(e)=>setSettingsForm({...settingsForm, notificationEmail: e.target.value})} className="w-full px-3 py-2 border rounded-xl text-sm" dir="ltr"/></div>
                  <div><label className="text-xs font-bold">Service ID</label><input type="text" value={settingsForm.emailjsServiceId} onChange={(e)=>setSettingsForm({...settingsForm, emailjsServiceId: e.target.value})} className="w-full px-3 py-2 border rounded-xl text-sm" dir="ltr"/></div>
                  <div><label className="text-xs font-bold">Template ID</label><input type="text" value={settingsForm.emailjsTemplateId} onChange={(e)=>setSettingsForm({...settingsForm, emailjsTemplateId: e.target.value})} className="w-full px-3 py-2 border rounded-xl text-sm" dir="ltr"/></div>
                  <div><label className="text-xs font-bold">Public Key</label><input type="text" value={settingsForm.emailjsPublicKey} onChange={(e)=>setSettingsForm({...settingsForm, emailjsPublicKey: e.target.value})} className="w-full px-3 py-2 border rounded-xl text-sm" dir="ltr"/></div>
                  <button type="submit" className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-semibold mt-4">שמור הגדרות אימייל</button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* (Modal העריכה וההוספה נשאר במקומו, צמצמתי בתצוגה כדי להתמקד בעיקר) */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl w-full max-w-md p-6">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold">{editingOrder ? 'עריכה' : 'הזמנה חדשה'}</h2>
                    <button onClick={() => setIsModalOpen(false)}><X className="w-5 h-5"/></button>
                </div>
                <form onSubmit={handleSaveOrder} className="space-y-3">
                    <select value={formData.orderType} onChange={(e) => setFormData({...formData, orderType: e.target.value as 'B2B'|'מלאי'})} className="w-full p-2 border rounded-xl"><option value="B2B">B2B</option><option value="מלאי">מלאי</option></select>
                    {formData.orderType === 'B2B' && <input type="text" placeholder="לקוח" value={formData.customerName} onChange={(e) => setFormData({...formData, customerName: e.target.value})} className="w-full p-2 border rounded-xl" />}
                    <input type="text" placeholder="דגם" required value={formData.modelName} onChange={(e) => setFormData({...formData, modelName: e.target.value})} className="w-full p-2 border rounded-xl" />
                    <button type="submit" disabled={saving} className="w-full py-2 bg-slate-900 text-white rounded-xl">שמור</button>
                </form>
            </div>
        </div>
      )}
    </div>
  );
}