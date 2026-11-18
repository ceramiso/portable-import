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
  ZoomIn,
  Check,
  User,
  LogOut,
  History,
  MessageSquare,
  Send,
  ShieldCheck,
  Users,
  Building2,
  Download,
  Upload,
  KeyRound,
  ShoppingBag,
  Layers,
  Hash
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
        const raw =
          localStorage.getItem('ceramiso_auth_session') ||
          sessionStorage.getItem('ceramiso_auth_session');
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
  const [adminActiveTab, setAdminActiveTab] = useState<'staff' | 'settings'>('staff');
  const [newStaffUsername, setNewStaffUsername] = useState('');
  const [newStaffPassword, setNewStaffPassword] = useState('');
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [editStaffUsername, setEditStaffUsername] = useState('');
  const [editStaffPassword, setEditStaffPassword] = useState('');

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
  const currentDisplayName = loggedInUser
    ? loggedInUser.isAdmin
      ? `${loggedInUser.username} (מנהל)`
      : loggedInUser.username
    : '';

  useEffect(() => {
    signInAnonymously(auth).catch((err) => {
      console.error('Background auth error:', err);
      setConnecting(false);
    });
    const unsub = onAuthStateChanged(auth, (u) => {
      setFbUser(u);
      setConnecting(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!fbUser) return;

    const ordersRef = collection(db, ...ORDERS_PATH);
    const qOrders = query(ordersRef, orderBy('createdAt', 'desc'));
    const unsubOrders = onSnapshot(qOrders, (snapshot) => {
      const list: Order[] = snapshot.docs.map((d) => {
        const data = d.data();
        const legacyOrdered =
          data.status === 'הוזמן מספק' ||
          data.status === 'בדרך / בנמל' ||
          data.status === 'הגיע למחסן' ||
          data.status === 'נמסר ללקוח';
        return {
          id: d.id,
          orderType: data.orderType === 'מלאי' ? 'מלאי' : 'B2B',
          customerName: data.customerName || '',
          orderNumber: data.orderNumber || '',
          modelName: data.modelName || '',
          quantity: data.quantity || '',
          supplier: data.supplier || '',
          isOrdered: typeof data.isOrdered === 'boolean' ? data.isOrdered : legacyOrdered,
          isReceived:
            typeof data.isReceived === 'boolean'
              ? data.isReceived
              : data.status === 'נמסר ללקוח',
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

    const staffRef = collection(db, ...STAFF_PATH);
    const unsubStaff = onSnapshot(staffRef, (snapshot) => {
      const list: StaffRecord[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          username: data.username || '',
          password: data.password || '',
          active: data.active !== false,
          createdAt: data.createdAt || Date.now(),
        };
      });
      setStaffList(list);
    });

    const settingsRef = doc(db, ...SETTINGS_DOC_PATH);
    const unsubSettings = onSnapshot(settingsRef, (snap) => {
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

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');

    const uClean = usernameInput.trim();
    const pClean = passwordInput;
    const currentAdminPass = settings.adminPassword || DEFAULT_ADMIN_PASSWORD;

    if (uClean.toLowerCase() === DEFAULT_ADMIN_USERNAME.toLowerCase()) {
      if (pClean === currentAdminPass) {
        const sessionObj = { username: DEFAULT_ADMIN_USERNAME, isAdmin: true };
        saveAuthSession(sessionObj);
        setLoggedInUser(sessionObj);
        setPasswordInput('');
        return;
      } else {
        setLoginError('סיסמת מנהל שגויה.');
        return;
      }
    }

    const matched = staffList.find(
      (s) => s.username.toLowerCase() === uClean.toLowerCase() && s.password === pClean
    );

    if (!matched) {
      setLoginError('שם משתמש או סיסמה שגויים. פנה למנהל המערכת להרשאה.');
      return;
    }

    if (!matched.active) {
      setLoginError('משתמש זה הושבת על ידי מנהל המערכת.');
      return;
    }

    const sessionObj = { username: matched.username, isAdmin: false };
    saveAuthSession(sessionObj);
    setLoggedInUser(sessionObj);
    setPasswordInput('');
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
  };

  const handleLogout = () => {
    localStorage.removeItem('ceramiso_auth_session');
    sessionStorage.removeItem('ceramiso_auth_session');
    setLoggedInUser(null);
    setPasswordInput('');
  };

  const sendBackgroundOfficeEmail = async (data: {
    orderType: 'מלאי' | 'B2B';
    customerName: string;
    orderNumber: string;
    modelName: string;
    quantity: string;
    supplier: string;
    isOrdered: boolean;
    eta: string;
    notes: string;
  }) => {
    const {
      notificationEmail,
      emailjsServiceId,
      emailjsTemplateId,
      emailjsPublicKey,
    } = settings;

    if (!notificationEmail || !emailjsServiceId || !emailjsTemplateId || !emailjsPublicKey) return;

    const subject =
      data.orderType === 'B2B'
        ? `הזמנת יבוא חדשה (B2B) - ${data.customerName} | הזמנה #${data.orderNumber}`
        : `הזמנת יבוא חדשה למלאי - ${data.modelName}`;

    const messageDetails = [
      `נוספה הזמנת יבוא חדשה למערכת קרמיסו על ידי ${currentDisplayName}:`,
      `סוג הזמנה: ${data.orderType}`,
      ...(data.orderType === 'B2B' ? [`שם לקוח: ${data.customerName}`, `מספר הזמנה: ${data.orderNumber}`] : []),
      `דגם / מק"ט: ${data.modelName}`,
      `כמות / מ"ר: ${data.quantity || '-'}`,
      `ספק / מפעל: ${data.supplier || '-'}`,
      `סטטוס הזמנה: ${data.isOrdered ? 'הוזמן מהספק' : 'טרם הוזמן'}`,
      `צפי הגעה: ${data.eta || '-'}`,
      `הערות: ${data.notes || '-'}`,
    ].join('\n');

    try {
      await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: emailjsServiceId.trim(),
          template_id: emailjsTemplateId.trim(),
          user_id: emailjsPublicKey.trim(),
          template_params: {
            to_email: notificationEmail.trim(),
            subject,
            message: messageDetails,
          },
        }),
      });
    } catch (err) {
      console.error('Background Office email failed:', err);
    }
  };

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    if (!newStaffUsername.trim() || !newStaffPassword.trim()) {
      alert('נא למלא שם משתמש וסיסמה');
      return;
    }

    const uLower = newStaffUsername.trim().toLowerCase();
    if (uLower === DEFAULT_ADMIN_USERNAME.toLowerCase() || staffList.some((s) => s.username.toLowerCase() === uLower)) {
      alert('שם משתמש זה כבר קיים במערכת.');
      return;
    }

    setCreatingStaff(true);
    try {
      await addDoc(collection(db, ...STAFF_PATH), {
        username: newStaffUsername.trim(),
        password: newStaffPassword.trim(),
        active: true,
        createdAt: Date.now(),
      });
      setNewStaffUsername('');
      setNewStaffPassword('');
    } catch {
      alert('שגיאה בהוספת המשתמש');
    } finally {
      setCreatingStaff(false);
    }
  };

  const handleSaveStaffEdit = async (id: string) => {
    if (!isAdmin || !editStaffUsername.trim() || !editStaffPassword.trim()) return;
    try {
      await updateDoc(doc(db, ...STAFF_PATH, id), {
        username: editStaffUsername.trim(),
        password: editStaffPassword.trim(),
      });
      setEditingStaffId(null);
    } catch {
      alert('שגיאה בעדכון');
    }
  };

  const handleToggleStaffActive = async (staff: StaffRecord) => {
    if (!isAdmin) return;
    try {
      await updateDoc(doc(db, ...STAFF_PATH, staff.id), { active: !staff.active });
    } catch {
      alert('שגיאה בשינוי סטטוס');
    }
  };

  const handleDeleteStaff = async (staff: StaffRecord) => {
    if (!isAdmin) return;
    const ok = window.confirm(`למחוק לצמיתות את "${staff.username}"?`);
    if (!ok) return;
    try {
      await deleteDoc(doc(db, ...STAFF_PATH, staff.id));
    } catch {
      alert('שגיאה במחיקה');
    }
  };

  const handleSaveAdminSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setSavingSettings(true);
    try {
      await setDoc(
        doc(db, ...SETTINGS_DOC_PATH),
        {
          notificationEmail: settingsForm.notificationEmail.trim(),
          emailjsServiceId: settingsForm.emailjsServiceId.trim(),
          emailjsTemplateId: settingsForm.emailjsTemplateId.trim(),
          emailjsPublicKey: settingsForm.emailjsPublicKey.trim(),
          adminPassword: settingsForm.adminPassword?.trim() || DEFAULT_ADMIN_PASSWORD,
        },
        { merge: true }
      );
      alert('ההגדרות נשמרו בהצלחה!');
    } catch {
      alert('שגיאה בשמירת ההגדרות');
    } finally {
      setSavingSettings(false);
    }
  };

  const openNewModal = () => {
    setEditingOrder(null);
    setFormData({
      orderType: 'B2B',
      customerName: '',
      orderNumber: '',
      modelName: '',
      quantity: '',
      supplier: '',
      isOrdered: false,
      eta: '',
      notes: '',
      images: [],
    });
    setIsModalOpen(true);
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

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      const compressedList: string[] = [];
      for (let i = 0; i < files.length; i++) {
        compressedList.push(await compressImage(files[i]));
      }
      setFormData((prev) => ({ ...prev, images: [...prev.images, ...compressedList] }));
    } catch {
      alert('שגיאה בטעינת תמונות');
    }
    e.target.value = '';
  };

  const removeImageFromForm = (index: number) => {
    setFormData((prev) => ({ ...prev, images: prev.images.filter((_, idx) => idx !== index) }));
  };

  const describeChanges = (oldOrder: Order, newData: typeof formData): string => {
    const changes: string[] = [];
    if (oldOrder.orderType !== newData.orderType) changes.push('סוג הזמנה');
    if (oldOrder.customerName !== newData.customerName) changes.push('שם לקוח');
    if (oldOrder.orderNumber !== newData.orderNumber) changes.push('מספר הזמנה');
    if (oldOrder.modelName !== newData.modelName) changes.push('דגם');
    if (oldOrder.quantity !== newData.quantity) changes.push('כמות');
    if (oldOrder.supplier !== newData.supplier) changes.push('ספק');
    if (Boolean(oldOrder.isOrdered) !== Boolean(newData.isOrdered)) changes.push('סטטוס הזמנה');
    if (oldOrder.eta !== newData.eta) changes.push('צפי הגעה');
    if (oldOrder.notes !== newData.notes) changes.push('הערות');
    if ((oldOrder.images?.length || 0) !== newData.images.length) changes.push('תמונות');
    return changes.length > 0 ? `ערך: ${changes.join(', ')}` : 'שמר עריכה ללא שינויים';
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.modelName.trim()) {
      alert('נא למלא דגם');
      return;
    }
    if (formData.orderType === 'B2B' && (!formData.customerName.trim() || !formData.orderNumber.trim())) {
      alert('בהזמנת B2B חובה למלא שם לקוח ומספר הזמנה');
      return;
    }

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
      const ordersRef = collection(db, ...ORDERS_PATH);
      if (editingOrder) {
        const actionText = describeChanges(editingOrder, { ...formData, ...cleanedPayload });
        const logEntry: LogEntry = { user: currentDisplayName, action: actionText, timestamp: Date.now() };
        await updateDoc(doc(db, ...ORDERS_PATH, editingOrder.id), {
          ...cleanedPayload,
          logs: arrayUnion(logEntry),
        });
      } else {
        const initialLog: LogEntry = {
          user: currentDisplayName,
          action: `יצר הזמנת ${cleanedPayload.orderType} (${cleanedPayload.isOrdered ? 'הוזמן' : 'לא הוזמן'})`,
          timestamp: Date.now(),
        };
        await addDoc(ordersRef, {
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
    const nextVal = !order.isOrdered;
    try {
      await updateDoc(doc(db, ...ORDERS_PATH, order.id), {
        isOrdered: nextVal,
        logs: arrayUnion({
          user: currentDisplayName,
          action: nextVal ? 'סימן V: הוזמן' : 'ביטל סימון הוזמן',
          timestamp: Date.now(),
        }),
      });
    } catch {
      alert('שגיאה בעדכון');
    }
  };

  const handleConfirmReceived = async (order: Order) => {
    if (!isAdmin) return;
    if (!window.confirm('האם לאשר אספקה ומסירה?')) return;
    try {
      await updateDoc(doc(db, ...ORDERS_PATH, order.id), {
        isReceived: true,
        isOrdered: true,
        logs: arrayUnion({ user: currentDisplayName, action: 'אישר קבלת סחורה', timestamp: Date.now() }),
      });
    } catch {
      alert('שגיאה באישור');
    }
  };

  const handleDelete = async (order: Order) => {
    if (!isAdmin) return;
    const title = order.orderType === 'B2B' ? `${order.customerName}` : `${order.modelName}`;
    if (!window.confirm(`האם למחוק לצמיתות את "${title}"?`)) return;
    try {
      await deleteDoc(doc(db, ...ORDERS_PATH, order.id));
      if (activeDetailsOrderId === order.id) setActiveDetailsOrderId(null);
    } catch {
      alert('שגיאה במחיקה');
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDetailsOrderId || !newMessageText.trim()) return;
    setSendingMsg(true);
    try {
      await updateDoc(doc(db, ...ORDERS_PATH, activeDetailsOrderId), {
        messages: arrayUnion({ user: currentDisplayName, text: newMessageText.trim(), timestamp: Date.now() }),
      });
      setNewMessageText('');
    } catch {
      alert('שגיאה בשליחה');
    } finally {
      setSendingMsg(false);
    }
  };

  const handleExportBackup = () => {
    const dataStr = JSON.stringify(orders, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ceramiso-orders-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isAdmin) return;
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text) as Order[];
      for (const ord of imported) {
        const { id, ...rest } = ord;
        await setDoc(doc(db, ...ORDERS_PATH, id || `imp_${Date.now()}`), rest, { merge: true });
      }
      alert('שוחזר בהצלחה!');
    } catch {
      alert('קובץ לא תקין');
    }
    e.target.value = '';
  };

  // --- Screens ---

  if (connecting) {
    return (
      <div dir="rtl" className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center animate-pulse">
          <div className="w-12 h-12 rounded-2xl bg-slate-900 text-amber-400 font-bold text-2xl flex items-center justify-center mx-auto mb-3 shadow-lg">C</div>
          <p className="text-sm text-slate-500 font-medium">טוען מערכת...</p>
        </div>
      </div>
    );
  }

  if (!loggedInUser) {
    return (
      <div dir="rtl" className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-slate-100 flex items-center justify-center p-4 sm:p-6">
        <div className="bg-white/95 backdrop-blur-md rounded-3xl w-full max-w-sm sm:max-w-md p-6 sm:p-10 shadow-2xl border border-slate-200/80">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-slate-900 flex items-center justify-center text-amber-400 font-bold text-2xl mx-auto shadow-md mb-4">C</div>
            <span className="text-[10px] sm:text-[11px] font-bold tracking-[0.2em] uppercase text-amber-600 block mb-1">CERAMISO IMPORT</span>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">ניהול הזמנות</h1>
          </div>
          {loginError && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium p-3.5 rounded-2xl mb-5 text-center">
              {loginError}
            </div>
          )}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">שם משתמש</label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                <input type="text" required autoFocus value={usernameInput} onChange={(e) => setUsernameInput(e.target.value)}
                  className="w-full pr-10 pl-4 py-3 sm:py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:outline-none transition" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">סיסמה</label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                <input type="password" required dir="ltr" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)}
                  className="w-full pr-10 pl-4 py-3 sm:py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm text-left focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:outline-none transition" />
              </div>
            </div>
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-slate-900" />
              <span className="text-xs font-medium text-slate-600">זכור אותי</span>
            </label>
            <button type="submit" className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm rounded-2xl shadow-md transition mt-2 active:scale-95">
              כניסה
            </button>
          </form>
        </div>
      </div>
    );
  }

  const filteredOrders = orders.filter((order) => {
    const s = searchTerm.toLowerCase();
    const matchSearch = order.customerName.toLowerCase().includes(s) || order.orderNumber.toLowerCase().includes(s) || order.modelName.toLowerCase().includes(s) || order.supplier.toLowerCase().includes(s);
    const matchStatus = statusFilter === 'הכל' || (statusFilter === 'לא הוזמן' && !order.isOrdered && !order.isReceived) || (statusFilter === 'הוזמן' && order.isOrdered && !order.isReceived) || (statusFilter === 'התקבל' && order.isReceived);
    const matchType = typeFilter === 'הכל' || order.orderType === typeFilter;
    return matchSearch && matchStatus && matchType;
  });

  const activeDetailsOrder = orders.find((o) => o.id === activeDetailsOrderId) || null;

  return (
    <div dir="rtl" className="min-h-screen bg-[#F8F9FA] text-slate-800 pb-20 antialiased">
      <header className="bg-white/90 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
          <div className="flex w-full sm:w-auto items-center justify-between sm:justify-start gap-3.5">
            <div className="flex items-center gap-3.5">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-slate-900 flex items-center justify-center text-amber-400 font-bold text-lg shadow-sm">C</div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-sm sm:text-lg font-bold text-slate-900">קרמיסו • הזמנות יבוא</h1>
                  {isAdmin && <span className="hidden sm:inline-flex items-center gap-1 text-[10px] sm:text-[11px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-semibold"><ShieldCheck className="w-3 h-3" /> מנהל</span>}
                </div>
                <div className="flex items-center gap-2 text-[11px] sm:text-xs text-slate-500 mt-0.5">
                  <span className="font-medium">{currentDisplayName}</span>
                  <span>•</span>
                  <button onClick={handleLogout} className="text-slate-400 hover:text-slate-800 flex items-center gap-1"><LogOut className="w-3 h-3" /> התנתק</button>
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex w-full sm:w-auto items-center gap-2 justify-end">
            {isAdmin && (
              <>
                <button onClick={() => setIsAdminModalOpen(true)} className="flex-1 sm:flex-none justify-center flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-slate-700 transition">
                  <Users className="w-4 h-4 text-slate-500" />
                  <span className="hidden sm:inline">מורשים והגדרות</span>
                  <span className="sm:hidden">הגדרות</span>
                </button>
                <div className="hidden sm:flex items-center gap-2">
                  <button onClick={handleExportBackup} className="p-2.5 bg-slate-100 text-slate-600 rounded-xl"><Download className="w-4 h-4" /></button>
                  <button onClick={() => importInputRef.current?.click()} className="p-2.5 bg-slate-100 text-slate-600 rounded-xl"><Upload className="w-4 h-4" /></button>
                  <input ref={importInputRef} type="file" accept=".json" onChange={handleImportBackup} className="hidden" />
                </div>
              </>
            )}
            <button onClick={openNewModal} className="flex-1 sm:flex-none justify-center flex items-center gap-1.5 bg-slate-900 text-white font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-sm hover:bg-slate-800 transition active:scale-95">
              <Plus className="w-4 h-4 text-amber-400" /> הזמנה חדשה
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 mt-4 sm:mt-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 mb-4 sm:mb-6">
          {[
            { label: 'כל ההזמנות', value: orders.length, filter: 'הכל', c: 'text-slate-900' },
            { label: 'ממתינות להזמנה', value: orders.filter(o=>!o.isOrdered && !o.isReceived).length, filter: 'לא הוזמן', c: 'text-amber-600' },
            { label: 'הוזמנו מספק', value: orders.filter(o=>o.isOrdered && !o.isReceived).length, filter: 'הוזמן', c: 'text-blue-600' },
            { label: 'התקבלו וסופקו', value: orders.filter(o=>o.isReceived).length, filter: 'התקבל', c: 'text-emerald-600' }
          ].map((st) => (
            <button key={st.filter} onClick={() => setStatusFilter(st.filter)}
              className={`text-right p-3 sm:p-4 rounded-2xl border transition ${statusFilter === st.filter ? 'bg-white shadow-sm ring-1 ring-slate-900/10' : 'bg-white/70 border-slate-200/70'}`}>
              <span className="text-[10px] sm:text-xs font-medium text-slate-500 block">{st.label}</span>
              <span className={`text-xl sm:text-2xl font-bold mt-1 block ${st.c}`}>{st.value}</span>
            </button>
          ))}
        </div>

        <div className="bg-white p-2.5 sm:p-3.5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
            <input type="text" placeholder="חיפוש לפי לקוח, מק״ט..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pr-10 pl-4 py-2.5 bg-slate-50 border-none rounded-xl text-sm focus:bg-slate-100 focus:outline-none" />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden">
            <div className="flex bg-slate-100 p-1 rounded-xl shrink-0">
              {['הכל', 'B2B', 'מלאי'].map(t => (
                <button key={t} onClick={() => setTypeFilter(t)}
                  className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs font-semibold ${typeFilter === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{t}</button>
              ))}
            </div>
            <div className="flex bg-slate-100 p-1 rounded-xl shrink-0">
              {['הכל', 'לא הוזמן', 'הוזמן', 'התקבל'].map(s => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs font-semibold ${statusFilter === s ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500'}`}>{s}</button>
              ))}
            </div>
          </div>
        </div>

        {filteredOrders.length === 0 ? (
          <div className="bg-white rounded-3xl p-10 sm:p-16 text-center border border-slate-200">
            <Package className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <h3 className="font-bold text-slate-800">לא נמצאו הזמנות</h3>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {filteredOrders.map(order => (
              <div key={order.id} className="bg-white rounded-2xl border border-slate-200/80 hover:border-slate-300 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="px-4 sm:px-5 pt-4 sm:pt-5 pb-3 flex justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] sm:text-[11px] font-bold ${order.orderType === 'B2B' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>
                          {order.orderType === 'B2B' ? <Building2 className="w-3 h-3 text-amber-400"/> : <Layers className="w-3 h-3"/>} {order.orderType}
                        </span>
                        {order.isReceived ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/15">התקבל</span>
                        ) : order.isOrdered ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 ring-1 ring-blue-600/15">הוזמן</span>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 ring-1 ring-amber-600/20">טרם הוזמן</span>
                        )}
                      </div>
                      <div className="mt-2.5">
                        <h3 className="text-sm sm:text-base font-bold text-slate-900 leading-snug">{order.orderType === 'B2B' ? order.customerName : 'מלאי'}</h3>
                        {order.orderType === 'B2B' && <span className="text-[11px] sm:text-xs font-medium text-slate-500 flex items-center gap-1 mt-0.5"><Hash className="w-3 h-3"/> הזמנה {order.orderNumber}</span>}
                      </div>
                    </div>
                    <div className="flex gap-0.5">
                      <button onClick={() => openEditModal(order)} className="p-2 sm:p-2.5 text-slate-400 hover:text-slate-900 bg-slate-50 rounded-xl"><Edit3 className="w-4 h-4" /></button>
                      {isAdmin && <button onClick={() => handleDelete(order)} className="p-2 sm:p-2.5 text-slate-400 hover:text-rose-600 bg-slate-50 rounded-xl"><Trash2 className="w-4 h-4" /></button>}
                    </div>
                  </div>
                  <div className="px-4 sm:px-5 py-3 border-t border-slate-100 space-y-1.5 sm:space-y-2 text-xs sm:text-sm">
                    <div className="flex justify-between gap-3"><span className="text-slate-400 shrink-0">דגם/מק״ט</span><span className="font-semibold text-slate-900 text-left">{order.modelName}</span></div>
                    {order.quantity && <div className="flex justify-between gap-3"><span className="text-slate-400">כמות</span><span className="font-medium text-slate-700">{order.quantity}</span></div>}
                    {order.supplier && <div className="flex justify-between gap-3"><span className="text-slate-400">ספק</span><span className="font-medium text-slate-700">{order.supplier}</span></div>}
                    {order.eta && <div className="flex justify-between gap-3"><span className="text-slate-400 flex items-center gap-1"><Calendar className="w-3 h-3"/> צפי הגעה</span><span className="font-medium text-slate-700">{order.eta}</span></div>}
                    {order.notes && <div className="mt-2 bg-slate-50 p-2 sm:p-3 rounded-xl text-xs text-slate-600 flex items-start gap-1.5"><FileText className="w-3.5 h-3.5 shrink-0 mt-0.5"/><span>{order.notes}</span></div>}
                  </div>
                </div>
                <div className="px-4 sm:px-5 pb-4 sm:pb-5 pt-2 space-y-2.5 sm:space-y-3">
                  {order.images?.length > 0 && (
                    <div className="grid grid-cols-4 gap-2">
                      {order.images.map((img, idx) => (
                        <button key={idx} onClick={() => setLightboxImage(img)} className="relative aspect-square rounded-xl overflow-hidden border border-slate-200">
                          <img src={img} className="w-full h-full object-cover" alt="" />
                          <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100"><ZoomIn className="w-4 h-4 text-white" /></div>
                        </button>
                      ))}
                    </div>
                  )}
                  {!order.isReceived && (
                    <label className="flex items-center justify-between bg-slate-50 border border-slate-200/70 px-3.5 py-3 rounded-xl cursor-pointer">
                      <span className="text-xs font-semibold text-slate-700">הוזמן מהספק</span>
                      <input type="checkbox" checked={Boolean(order.isOrdered)} onChange={() => handleToggleOrderedQuick(order)} className="w-4.5 h-4.5 rounded border-slate-300" />
                    </label>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => { setActiveDetailsOrderId(order.id); setActiveTab('chat'); }} className="py-2 sm:py-2.5 flex justify-center gap-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-600"><MessageSquare className="w-3.5 h-3.5"/> הודעות ({order.messages?.length||0})</button>
                    <button onClick={() => { setActiveDetailsOrderId(order.id); setActiveTab('logs'); }} className="py-2 sm:py-2.5 flex justify-center gap-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-600"><History className="w-3.5 h-3.5"/> היסטוריה ({order.logs?.length||0})</button>
                  </div>
                  {isAdmin && !order.isReceived && (
                    <button onClick={() => handleConfirmReceived(order)} className="w-full py-2.5 sm:py-3 bg-emerald-600 text-white text-xs font-semibold rounded-xl flex justify-center gap-1.5 mt-1 active:scale-95"><Check className="w-4 h-4"/> אישור התקבל וסופק</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* New/Edit Order Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-white w-full sm:max-w-lg h-[90vh] sm:h-auto sm:max-h-[85vh] sm:rounded-3xl rounded-t-3xl shadow-2xl flex flex-col">
            <div className="px-5 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex items-center justify-between shrink-0">
              <h2 className="text-base sm:text-lg font-bold text-slate-900">{editingOrder ? 'עריכת הזמנה' : 'הזמנה חדשה'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="p-2 bg-slate-50 text-slate-500 rounded-full"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
              <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1.5 rounded-2xl">
                <button type="button" onClick={() => setFormData({...formData, orderType: 'B2B'})} className={`py-2.5 sm:py-3 rounded-xl text-xs font-bold flex justify-center gap-1.5 ${formData.orderType === 'B2B' ? 'bg-white shadow-sm' : 'text-slate-500'}`}><Building2 className="w-4 h-4 text-amber-500"/> B2B</button>
                <button type="button" onClick={() => setFormData({...formData, orderType: 'מלאי'})} className={`py-2.5 sm:py-3 rounded-xl text-xs font-bold flex justify-center gap-1.5 ${formData.orderType === 'מלאי' ? 'bg-white shadow-sm' : 'text-slate-500'}`}><Layers className="w-4 h-4"/> מלאי</button>
              </div>
              {formData.orderType === 'B2B' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                  <div><label className="block text-xs font-semibold mb-1.5">שם לקוח *</label><input type="text" required value={formData.customerName} onChange={e=>setFormData({...formData, customerName:e.target.value})} className="w-full p-3 rounded-xl border border-slate-200 text-sm" placeholder="שם הלקוח" /></div>
                  <div><label className="block text-xs font-semibold mb-1.5">מספר הזמנה *</label><input type="text" required value={formData.orderNumber} onChange={e=>setFormData({...formData, orderNumber:e.target.value})} className="w-full p-3 rounded-xl border border-slate-200 text-sm" placeholder="10452" /></div>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div><label className="block text-xs font-semibold mb-1.5">דגם / מק״ט *</label><input type="text" required value={formData.modelName} onChange={e=>setFormData({...formData, modelName:e.target.value})} className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:bg-white" /></div>
                <div><label className="block text-xs font-semibold mb-1.5">כמות / מ״ר</label><input type="text" value={formData.quantity} onChange={e=>setFormData({...formData, quantity:e.target.value})} className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:bg-white" /></div>
                <div><label className="block text-xs font-semibold mb-1.5">ספק</label><input type="text" value={formData.supplier} onChange={e=>setFormData({...formData, supplier:e.target.value})} className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:bg-white" /></div>
                <div><label className="block text-xs font-semibold mb-1.5">צפי הגעה</label><input type="date" value={formData.eta} onChange={e=>setFormData({...formData, eta:e.target.value})} className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:bg-white" /></div>
              </div>
              <label className="flex justify-between items-center bg-slate-50 border border-slate-200 p-3.5 rounded-2xl">
                <div>
                  <span className="block text-sm font-semibold">הוזמן מהספק</span>
                  <span className="block text-[11px] text-slate-400">ברירת מחדל: לא</span>
                </div>
                <input type="checkbox" checked={formData.isOrdered} onChange={e=>setFormData({...formData, isOrdered:e.target.checked})} className="w-5 h-5" />
              </label>
              <div>
                <label className="block text-xs font-semibold mb-1.5">הערות</label>
                <textarea rows={2} value={formData.notes} onChange={e=>setFormData({...formData, notes:e.target.value})} className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:bg-white" />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5">תמונות / תעודות</label>
                <label className="flex flex-col items-center p-4 border border-dashed border-slate-300 rounded-2xl bg-slate-50 cursor-pointer">
                  <ImageIcon className="w-5 h-5 text-slate-400" />
                  <span className="text-xs text-slate-600 mt-1">לחץ להעלאת תמונות</span>
                  <input type="file" multiple accept="image/*" onChange={handleImageUpload} className="hidden" />
                </label>
                {formData.images.length > 0 && (
                  <div className="grid grid-cols-4 gap-2 mt-3">
                    {formData.images.map((img, i) => (
                      <div key={i} className="relative aspect-square rounded-xl border border-slate-200 overflow-hidden">
                        <img src={img} className="w-full h-full object-cover" alt="" />
                        <button type="button" onClick={() => removeImageFromForm(i)} className="absolute top-1 right-1 bg-slate-900/70 text-white rounded-full p-1"><X className="w-3 h-3"/></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </form>
            <div className="p-4 sm:p-5 border-t border-slate-100 flex gap-3 shrink-0">
              <button type="button" onClick={() => setIsModalOpen(false)} className="px-5 py-3.5 bg-slate-100 text-slate-600 text-sm font-semibold rounded-xl flex-1">ביטול</button>
              <button onClick={handleSave} disabled={saving} className="px-5 py-3.5 bg-slate-900 text-white text-sm font-semibold rounded-xl flex-[2] active:scale-95 disabled:opacity-50">{saving ? 'שומר...' : (editingOrder ? 'שמור שינויים' : 'צור הזמנה')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Settings Modal */}
      {isAdmin && isAdminModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-white w-full sm:max-w-xl h-[90vh] sm:h-auto sm:max-h-[85vh] sm:rounded-3xl rounded-t-3xl shadow-2xl flex flex-col">
            <div className="px-5 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex justify-between items-center shrink-0">
              <h2 className="text-base sm:text-lg font-bold">הגדרות מנהל</h2>
              <button onClick={() => setIsAdminModalOpen(false)} className="p-2 bg-slate-50 text-slate-500 rounded-full"><X className="w-5 h-5"/></button>
            </div>
            
            <div className="flex px-4 sm:px-6 mt-4 gap-2 shrink-0">
              <button onClick={() => setAdminActiveTab('staff')} className={`flex-1 py-2 text-xs sm:text-sm font-semibold rounded-xl ${adminActiveTab === 'staff' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>ניהול מורשים</button>
              <button onClick={() => setAdminActiveTab('settings')} className={`flex-1 py-2 text-xs sm:text-sm font-semibold rounded-xl ${adminActiveTab === 'settings' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>הגדרות מייל וסיסמה</button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              {adminActiveTab === 'staff' ? (
                <div className="space-y-6">
                  <form onSubmit={handleAddStaff} className="bg-slate-50 p-4 rounded-2xl border border-slate-200">
                    <h3 className="text-sm font-bold mb-3 text-slate-800">הוספת עובד מורשה חדש</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                      <input type="text" placeholder="שם משתמש" value={newStaffUsername} onChange={e=>setNewStaffUsername(e.target.value)} className="p-3 bg-white border border-slate-200 rounded-xl text-sm" />
                      <input type="text" placeholder="סיסמה" value={newStaffPassword} onChange={e=>setNewStaffPassword(e.target.value)} className="p-3 bg-white border border-slate-200 rounded-xl text-sm" />
                    </div>
                    <button type="submit" disabled={creatingStaff} className="w-full py-3 bg-slate-900 text-white text-xs font-bold rounded-xl active:scale-95">הוסף עובד</button>
                  </form>
                  <div>
                    <h3 className="text-sm font-bold mb-3 text-slate-800">עובדים קיימים ({staffList.length})</h3>
                    <div className="space-y-2">
                      {staffList.map(staff => (
                        <div key={staff.id} className="bg-white p-3.5 border border-slate-200 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                          {editingStaffId === staff.id ? (
                            <div className="flex-1 flex flex-col sm:flex-row gap-2 w-full">
                              <input value={editStaffUsername} onChange={e=>setEditStaffUsername(e.target.value)} className="p-2 border rounded-lg text-sm w-full sm:w-auto" />
                              <input value={editStaffPassword} onChange={e=>setEditStaffPassword(e.target.value)} className="p-2 border rounded-lg text-sm w-full sm:w-auto" />
                              <button onClick={() => handleSaveStaffEdit(staff.id)} className="bg-slate-900 text-white px-3 py-2 rounded-lg text-xs w-full sm:w-auto">שמור</button>
                              <button onClick={() => setEditingStaffId(null)} className="bg-slate-100 px-3 py-2 rounded-lg text-xs w-full sm:w-auto">בטל</button>
                            </div>
                          ) : (
                            <>
                              <div>
                                <div className="font-bold text-sm flex items-center gap-2">{staff.username} {!staff.active && <span className="text-[10px] bg-rose-100 text-rose-700 px-2 py-0.5 rounded">מושבת</span>}</div>
                                <div className="text-[11px] text-slate-500 font-mono mt-0.5">סיסמה: {staff.password}</div>
                              </div>
                              <div className="flex gap-2 w-full sm:w-auto">
                                <button onClick={() => handleToggleStaffActive(staff)} className={`flex-1 sm:flex-none px-3 py-2 rounded-lg text-xs font-semibold ${staff.active ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{staff.active ? 'השבת' : 'הפעל'}</button>
                                <button onClick={() => { setEditingStaffId(staff.id); setEditStaffUsername(staff.username); setEditStaffPassword(staff.password); }} className="flex-1 sm:flex-none px-3 py-2 bg-slate-100 rounded-lg text-xs">ערוך</button>
                                <button onClick={() => handleDeleteStaff(staff)} className="flex-1 sm:flex-none px-3 py-2 bg-rose-50 text-rose-600 rounded-lg text-xs">מחק</button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSaveAdminSettings} className="space-y-4">
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200">
                    <h3 className="text-sm font-bold mb-4 text-slate-800">הגדרות EmailJS - חיבור לאופיס</h3>
                    <div className="space-y-3">
                      <div><label className="block text-xs font-semibold mb-1">מייל יעד להתרעות מנהל</label><input type="email" value={settingsForm.notificationEmail} onChange={e=>setSettingsForm({...settingsForm, notificationEmail:e.target.value})} className="w-full p-3 rounded-xl border text-sm dir-ltr text-left" /></div>
                      <div><label className="block text-xs font-semibold mb-1">Service ID (Office)</label><input type="text" value={settingsForm.emailjsServiceId} onChange={e=>setSettingsForm({...settingsForm, emailjsServiceId:e.target.value})} className="w-full p-3 rounded-xl border text-sm dir-ltr text-left" /></div>
                      <div><label className="block text-xs font-semibold mb-1">Template ID</label><input type="text" value={settingsForm.emailjsTemplateId} onChange={e=>setSettingsForm({...settingsForm, emailjsTemplateId:e.target.value})} className="w-full p-3 rounded-xl border text-sm dir-ltr text-left" /></div>
                      <div><label className="block text-xs font-semibold mb-1">Public Key</label><input type="text" value={settingsForm.emailjsPublicKey} onChange={e=>setSettingsForm({...settingsForm, emailjsPublicKey:e.target.value})} className="w-full p-3 rounded-xl border text-sm dir-ltr text-left" /></div>
                    </div>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200">
                    <h3 className="text-sm font-bold mb-4 text-slate-800">סיסמת מנהל ראשית (izak)</h3>
                    <div><input type="text" value={settingsForm.adminPassword} onChange={e=>setSettingsForm({...settingsForm, adminPassword:e.target.value})} className="w-full p-3 rounded-xl border text-sm dir-ltr text-left" /></div>
                  </div>
                  <button type="submit" disabled={savingSettings} className="w-full py-3.5 bg-slate-900 text-white text-sm font-bold rounded-xl active:scale-95">{savingSettings ? 'שומר...' : 'שמור הגדרות'}</button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Details Side Panel / Bottom Sheet (Chat & Logs) */}
      {activeDetailsOrder && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 flex justify-end">
          <div className="bg-white w-full sm:w-96 h-full flex flex-col shadow-2xl animate-in slide-in-from-right sm:border-l border-slate-200">
            <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0 mt-safe pt-safe">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">{activeDetailsOrder.orderType === 'B2B' ? activeDetailsOrder.customerName : activeDetailsOrder.modelName}</h3>
                <span className="text-[11px] text-slate-500">פירוט וצ׳אט</span>
              </div>
              <button onClick={() => setActiveDetailsOrderId(null)} className="p-2 bg-white rounded-full text-slate-400 shadow-sm"><X className="w-4 h-4"/></button>
            </div>
            
            <div className="flex px-4 mt-3 gap-2 shrink-0">
              <button onClick={() => setActiveTab('chat')} className={`flex-1 py-2 text-xs font-semibold rounded-xl flex justify-center gap-1.5 ${activeTab === 'chat' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}><MessageSquare className="w-3.5 h-3.5"/> צ׳אט</button>
              <button onClick={() => setActiveTab('logs')} className={`flex-1 py-2 text-xs font-semibold rounded-xl flex justify-center gap-1.5 ${activeTab === 'logs' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}><History className="w-3.5 h-3.5"/> היסטוריה</button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 flex flex-col-reverse">
              {activeTab === 'chat' ? (
                <div className="space-y-3 pb-2">
                  {activeDetailsOrder.messages.length === 0 ? (
                    <div className="text-center text-slate-400 text-xs py-10">אין הודעות בהזמנה זו</div>
                  ) : (
                    activeDetailsOrder.messages.map((msg, i) => (
                      <div key={i} className={`flex flex-col ${msg.user === currentDisplayName ? 'items-end' : 'items-start'}`}>
                        <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${msg.user === currentDisplayName ? 'bg-slate-900 text-white rounded-tr-sm' : 'bg-slate-100 text-slate-800 rounded-tl-sm'}`}>
                          {msg.user !== currentDisplayName && <span className="block text-[10px] font-bold text-slate-500 mb-0.5">{msg.user}</span>}
                          {msg.text}
                        </div>
                        <span className="text-[10px] text-slate-400 mt-1 mx-1">{formatDateTime(msg.timestamp)}</span>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="space-y-4 pb-2">
                  {activeDetailsOrder.logs.map((log, i) => (
                    <div key={i} className="flex gap-3 text-sm border-r-2 border-slate-200 pr-3 relative">
                      <div className="absolute -right-[7px] top-1.5 w-3 h-3 rounded-full bg-slate-300 border-2 border-white"></div>
                      <div>
                        <div className="font-bold text-slate-800 text-xs">{log.user}</div>
                        <div className="text-slate-600 text-xs mt-0.5">{log.action}</div>
                        <div className="text-[10px] text-slate-400 mt-1">{formatDateTime(log.timestamp)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {activeTab === 'chat' && (
              <form onSubmit={handleSendMessage} className="p-3 sm:p-4 border-t border-slate-100 bg-white shrink-0 pb-safe">
                <div className="relative flex items-center">
                  <input type="text" value={newMessageText} onChange={e=>setNewMessageText(e.target.value)} placeholder="הקלד הודעה..." className="w-full bg-slate-50 border border-slate-200 rounded-full py-3 pr-4 pl-12 text-sm focus:outline-none focus:bg-white" />
                  <button type="submit" disabled={sendingMsg || !newMessageText.trim()} className="absolute left-1.5 w-9 h-9 bg-amber-400 hover:bg-amber-500 text-slate-900 rounded-full flex items-center justify-center disabled:opacity-50 transition"><Send className="w-4 h-4 ml-1" /></button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Lightbox for Images */}
      {lightboxImage && (
        <div className="fixed inset-0 bg-black/95 z-[60] flex items-center justify-center p-2 sm:p-4" onClick={() => setLightboxImage(null)}>
          <button className="absolute top-4 right-4 sm:top-6 sm:right-6 text-white/50 hover:text-white p-2"><X className="w-6 h-6 sm:w-8 sm:h-8" /></button>
          <img src={lightboxImage} alt="" className="max-w-full max-h-full object-contain rounded-xl" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}