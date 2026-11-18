import React, { useState, useEffect, useRef } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  User as FirebaseUser,
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
  PlusCircle,
  Search,
  Trash2,
  Edit3,
  Image as ImageIcon,
  X,
  CheckCircle,
  Clock,
  Truck,
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
  Mail,
  Lock,
  Hash,
  Layers,
  Building2,
  UserPlus,
  KeyRound,
  Download,
  Upload,
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

// Secondary Firebase app instance so Admin can create new employee accounts without logging themselves out
const secondaryApp =
  getApps().find((a) => a.name === 'SecondaryApp') ||
  initializeApp(firebaseConfig, 'SecondaryApp');
const secondaryAuth = getAuth(secondaryApp);

const ADMIN_EMAIL = 'izak@ceramiso.co.il';
const ORDERS_PATH = ['artifacts', 'ceramic-orders', 'public', 'data', 'orders'] as const;
const USERS_PATH = ['artifacts', 'ceramic-orders', 'public', 'data', 'users'] as const;
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

interface AppUserRecord {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  active: boolean;
  createdAt: number;
}

interface Order {
  id: string;
  orderType: 'מלאי' | 'B2B';
  customerName: string;
  orderNumber: string;
  modelName: string;
  quantity: string;
  supplier: string;
  status: 'הוזמן מספק' | 'בדרך / בנמל' | 'הגיע למחסן' | 'נמסר ללקוח';
  eta: string;
  notes: string;
  images: string[];
  logs: LogEntry[];
  messages: ChatMessage[];
  createdBy?: string;
  createdAt: number;
}

const STATUS_OPTIONS: Order['status'][] = [
  'הוזמן מספק',
  'בדרך / בנמל',
  'הגיע למחסן',
  'נמסר ללקוח',
];

const STATUS_STYLES: Record<Order['status'], { bg: string; text: string; icon: React.ReactNode }> = {
  'הוזמן מספק': {
    bg: 'bg-amber-50 border-amber-200',
    text: 'text-amber-700',
    icon: <Clock className="w-4 h-4 text-amber-600" />,
  },
  'בדרך / בנמל': {
    bg: 'bg-blue-50 border-blue-200',
    text: 'text-blue-700',
    icon: <Truck className="w-4 h-4 text-blue-600" />,
  },
  'הגיע למחסן': {
    bg: 'bg-purple-50 border-purple-200',
    text: 'text-purple-700',
    icon: <Package className="w-4 h-4 text-purple-600" />,
  },
  'נמסר ללקוח': {
    bg: 'bg-emerald-50 border-emerald-200',
    text: 'text-emerald-700',
    icon: <CheckCircle className="w-4 h-4 text-emerald-600" />,
  },
};

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
  // Auth State
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  // Data State
  const [orders, setOrders] = useState<Order[]>([]);
  const [appUsers, setAppUsers] = useState<AppUserRecord[]>([]);
  const [notificationEmail, setNotificationEmail] = useState<string>(ADMIN_EMAIL);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('הכל');
  const [typeFilter, setTypeFilter] = useState<string>('הכל');

  // Order Add/Edit Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [saving, setSaving] = useState(false);

  // Admin Panel Modal (Users & Notification Email)
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUserNameValue, setEditUserNameValue] = useState('');
  const [adminEmailInput, setAdminEmailInput] = useState(ADMIN_EMAIL);
  const [savingSettings, setSavingSettings] = useState(false);

  // Chat & Logs Modal
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
    status: 'הוזמן מספק' as Order['status'],
    eta: '',
    notes: '',
    images: [] as string[],
  });

  const isAdmin = (authUser?.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase();

  // Resolve current user's display name from Firestore users list or email prefix
  const currentUserRecord = appUsers.find(
    (u) => u.email.toLowerCase() === (authUser?.email || '').toLowerCase()
  );
  const currentDisplayName = isAdmin
    ? currentUserRecord?.name || 'איציק (מנהל)'
    : currentUserRecord?.name || authUser?.email?.split('@')[0] || 'משתמש';

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // Load Orders, Users & Settings once authenticated
  useEffect(() => {
    if (!authUser) {
      setOrders([]);
      setAppUsers([]);
      return;
    }

    const ordersRef = collection(db, ...ORDERS_PATH);
    const qOrders = query(ordersRef, orderBy('createdAt', 'desc'));
    const unsubOrders = onSnapshot(qOrders, (snapshot) => {
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
          status: data.status || 'הוזמן מספק',
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

    const usersRef = collection(db, ...USERS_PATH);
    const unsubUsers = onSnapshot(usersRef, (snapshot) => {
      const list: AppUserRecord[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name || '',
          email: data.email || '',
          role: data.role === 'admin' ? 'admin' : 'user',
          active: data.active !== false,
          createdAt: data.createdAt || Date.now(),
        };
      });
      setAppUsers(list);
    });

    const settingsRef = doc(db, ...SETTINGS_DOC_PATH);
    const unsubSettings = onSnapshot(settingsRef, (snap) => {
      if (snap.exists()) {
        const email = snap.data().notificationEmail || ADMIN_EMAIL;
        setNotificationEmail(email);
        setAdminEmailInput(email);
      }
    });

    return () => {
      unsubOrders();
      unsubUsers();
      unsubSettings();
    };
  }, [authUser]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoggingIn(true);

    try {
      await setPersistence(
        auth,
        rememberMe ? browserLocalPersistence : browserSessionPersistence
      );
      await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPassword);
    } catch (err: any) {
      console.error('Login error:', err);
      setLoginError('אימייל או סיסמה שגויים, או שאין הרשאת גישה למערכת.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setLoginPassword('');
  };

  // Block disabled users (except admin)
  useEffect(() => {
    if (authUser && !isAdmin && currentUserRecord && currentUserRecord.active === false) {
      alert('המשתמש שלך הושבת על ידי מנהל המערכת.');
      signOut(auth);
    }
  }, [authUser, isAdmin, currentUserRecord]);

  // --- Admin User Management Handlers ---
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    if (!newUserName.trim() || !newUserEmail.trim() || newUserPassword.length < 6) {
      alert('נא למלא שם מלא, אימייל תקין וסיסמה של לפחות 6 תווים.');
      return;
    }

    setCreatingUser(true);
    try {
      const emailClean = newUserEmail.trim().toLowerCase();
      const cred = await createUserWithEmailAndPassword(
        secondaryAuth,
        emailClean,
        newUserPassword
      );
      await signOut(secondaryAuth);

      await setDoc(doc(db, ...USERS_PATH, cred.user.uid), {
        name: newUserName.trim(),
        email: emailClean,
        role: emailClean === ADMIN_EMAIL.toLowerCase() ? 'admin' : 'user',
        active: true,
        createdAt: Date.now(),
      });

      setNewUserName('');
      setNewUserEmail('');
      setNewUserPassword('');
      alert('המשתמש נוצר בהצלחה ויכול להתחבר כעת!');
    } catch (err: any) {
      console.error('Create user error:', err);
      if (err?.code === 'auth/email-already-in-use') {
        alert('כתובת האימייל הזו כבר רשומה במערכת.');
      } else {
        alert('שגיאה ביצירת המשתמש. ודא שכתובת האימייל תקינה והסיסמה בת 6 תווים לפחות.');
      }
    } finally {
      setCreatingUser(false);
    }
  };

  const handleUpdateUserName = async (userId: string) => {
    if (!isAdmin || !editUserNameValue.trim()) return;
    try {
      await updateDoc(doc(db, ...USERS_PATH, userId), {
        name: editUserNameValue.trim(),
      });
      setEditingUserId(null);
    } catch {
      alert('שגיאה בעדכון שם המשתמש');
    }
  };

  const handleToggleUserActive = async (userRec: AppUserRecord) => {
    if (!isAdmin) return;
    if (userRec.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      alert('לא ניתן להשבית את מנהל המערכת הראשי.');
      return;
    }
    try {
      await updateDoc(doc(db, ...USERS_PATH, userRec.id), {
        active: !userRec.active,
      });
    } catch {
      alert('שגיאה בשינוי סטטוס המשתמש');
    }
  };

  const handleDeleteUserRecord = async (userRec: AppUserRecord) => {
    if (!isAdmin) return;
    if (userRec.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      alert('לא ניתן למחוק את מנהל המערכת הראשי.');
      return;
    }
    const ok = window.confirm(`האם להסיר את המשתמש "${userRec.name}" (${userRec.email}) מהמערכת?`);
    if (!ok) return;

    try {
      await updateDoc(doc(db, ...USERS_PATH, userRec.id), {
        active: false,
      });
      await deleteDoc(doc(db, ...USERS_PATH, userRec.id));
    } catch {
      alert('שגיאה במחיקת המשתמש');
    }
  };

  const handleResetUserPassword = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email);
      alert(`נשלח קישור לאיפוס סיסמה לכתובת: ${email}`);
    } catch {
      alert('שגיאה בשליחת מייל איפוס סיסמה');
    }
  };

  const handleSaveNotificationEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setSavingSettings(true);
    try {
      await setDoc(
        doc(db, ...SETTINGS_DOC_PATH),
        { notificationEmail: adminEmailInput.trim() },
        { merge: true }
      );
      alert('כתובת האימייל לקבלת התראות נשמרה בהצלחה!');
    } catch {
      alert('שגיאה בשמירת ההגדרות');
    } finally {
      setSavingSettings(false);
    }
  };

  // --- Order Handlers ---
  const openNewModal = () => {
    setEditingOrder(null);
    setFormData({
      orderType: 'B2B',
      customerName: '',
      orderNumber: '',
      modelName: '',
      quantity: '',
      supplier: '',
      status: 'הוזמן מספק',
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
      status: order.status,
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
        const compressed = await compressImage(files[i]);
        compressedList.push(compressed);
      }
      setFormData((prev) => ({
        ...prev,
        images: [...prev.images, ...compressedList],
      }));
    } catch {
      alert('אירעה שגיאה בטעינת התמונות, נסה תמונה קטנה יותר.');
    }
    e.target.value = '';
  };

  const removeImageFromForm = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      images: prev.images.filter((_, idx) => idx !== index),
    }));
  };

  const describeChanges = (oldOrder: Order, newData: typeof formData): string => {
    const changes: string[] = [];
    if (oldOrder.orderType !== newData.orderType)
      changes.push(`סוג הזמנה (${oldOrder.orderType} ← ${newData.orderType})`);
    if (oldOrder.customerName !== newData.customerName)
      changes.push(`שם לקוח (${oldOrder.customerName || 'ריק'} ← ${newData.customerName || 'ריק'})`);
    if (oldOrder.orderNumber !== newData.orderNumber)
      changes.push(`מספר הזמנה (${oldOrder.orderNumber || 'ריק'} ← ${newData.orderNumber || 'ריק'})`);
    if (oldOrder.modelName !== newData.modelName)
      changes.push(`דגם (${oldOrder.modelName} ← ${newData.modelName})`);
    if (oldOrder.quantity !== newData.quantity)
      changes.push(`כמות (${oldOrder.quantity || 'ריק'} ← ${newData.quantity || 'ריק'})`);
    if (oldOrder.supplier !== newData.supplier)
      changes.push(`ספק (${oldOrder.supplier || 'ריק'} ← ${newData.supplier || 'ריק'})`);
    if (oldOrder.status !== newData.status)
      changes.push(`סטטוס (${oldOrder.status} ← ${newData.status})`);
    if (oldOrder.eta !== newData.eta)
      changes.push(`צפי הגעה (${oldOrder.eta || 'ללא'} ← ${newData.eta || 'ללא'})`);
    if (oldOrder.notes !== newData.notes) changes.push(`הערות`);
    if ((oldOrder.images?.length || 0) !== newData.images.length)
      changes.push(`תמונות (${oldOrder.images?.length || 0} ← ${newData.images.length})`);

    return changes.length > 0 ? `ערך: ${changes.join(', ')}` : 'שמר עריכה ללא שינוי שדות';
  };

  const triggerNewOrderEmail = (data: typeof formData) => {
    if (!notificationEmail) return;
    const subject =
      data.orderType === 'B2B'
        ? `הזמנת יבוא חדשה (B2B) - ${data.customerName} | הזמנה #${data.orderNumber}`
        : `הזמנת יבוא חדשה למלאי - ${data.modelName}`;

    const bodyLines = [
      `שלום,`,
      `נוספה הזמנת יבוא חדשה למערכת על ידי ${currentDisplayName}:`,
      ``,
      `סוג הזמנה: ${data.orderType}`,
      ...(data.orderType === 'B2B'
        ? [`שם לקוח: ${data.customerName}`, `מספר הזמנה: ${data.orderNumber}`]
        : []),
      `דגם / מק"ט: ${data.modelName}`,
      `כמות / מ"ר: ${data.quantity || '-'}`,
      `ספק / מפעל: ${data.supplier || '-'}`,
      `סטטוס: ${data.status}`,
      `צפי הגעה: ${data.eta || '-'}`,
      `הערות: ${data.notes || '-'}`,
    ];

    const mailtoUrl = `mailto:${encodeURIComponent(notificationEmail)}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(bodyLines.join('\n'))}`;
    window.open(mailtoUrl, '_blank');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.modelName.trim()) {
      alert('נא למלא דגם / מק״ט קרמיקה');
      return;
    }

    if (formData.orderType === 'B2B') {
      if (!formData.customerName.trim() || !formData.orderNumber.trim()) {
        alert('בהזמנת B2B חובה למלא שם לקוח ומספר הזמנה');
        return;
      }
    }

    // Prevent non-admin from setting status directly to 'נמסר ללקוח'
    if (!isAdmin && formData.status === 'נמסר ללקוח') {
      alert('רק מנהל המערכת יכול לסמן הזמנה כ"נמסר ללקוח".');
      return;
    }

    const cleanedPayload = {
      orderType: formData.orderType,
      customerName: formData.orderType === 'B2B' ? formData.customerName.trim() : '',
      orderNumber: formData.orderType === 'B2B' ? formData.orderNumber.trim() : '',
      modelName: formData.modelName.trim(),
      quantity: formData.quantity.trim(),
      supplier: formData.supplier.trim(),
      status: formData.status,
      eta: formData.eta,
      notes: formData.notes.trim(),
      images: formData.images,
    };

    setSaving(true);
    try {
      const ordersRef = collection(db, ...ORDERS_PATH);
      if (editingOrder) {
        const actionText = describeChanges(editingOrder, { ...formData, ...cleanedPayload });
        const logEntry: LogEntry = {
          user: currentDisplayName,
          action: actionText,
          timestamp: Date.now(),
        };
        const docRef = doc(db, ...ORDERS_PATH, editingOrder.id);
        await updateDoc(docRef, {
          ...cleanedPayload,
          logs: arrayUnion(logEntry),
        });
      } else {
        const initialLog: LogEntry = {
          user: currentDisplayName,
          action: `יצר הזמנת ${cleanedPayload.orderType}`,
          timestamp: Date.now(),
        };
        await addDoc(ordersRef, {
          ...cleanedPayload,
          createdBy: currentDisplayName,
          createdAt: Date.now(),
          logs: [initialLog],
          messages: [],
        });

        triggerNewOrderEmail({ ...formData, ...cleanedPayload });
      }
      setIsModalOpen(false);
    } catch (err) {
      console.error('Save error:', err);
      alert('שגיאה בשמירה לענן. ודא שהגדרת את כללי האבטחה ב-Firebase.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmReceived = async (order: Order) => {
    if (!isAdmin) return;
    const confirmed = window.confirm('האם אתה בטוח שאתה רוצה לאשר');
    if (!confirmed) return;

    try {
      const logEntry: LogEntry = {
        user: currentDisplayName,
        action: 'אישר אספקה ומסירה ("התקבל")',
        timestamp: Date.now(),
      };
      const docRef = doc(db, ...ORDERS_PATH, order.id);
      await updateDoc(docRef, {
        status: 'נמסר ללקוח',
        logs: arrayUnion(logEntry),
      });
    } catch (err) {
      console.error('Status update error:', err);
      alert('שגיאה באישור ההזמנה');
    }
  };

  const handleDelete = async (order: Order) => {
    if (!isAdmin) return;
    const title =
      order.orderType === 'B2B'
        ? `${order.customerName} (הזמנה #${order.orderNumber})`
        : `הזמנת מלאי - ${order.modelName}`;
    const confirmed = window.confirm(`האם למחוק לצמיתות את "${title}"?`);
    if (!confirmed) return;

    try {
      const docRef = doc(db, ...ORDERS_PATH, order.id);
      await deleteDoc(docRef);
      if (activeDetailsOrderId === order.id) {
        setActiveDetailsOrderId(null);
      }
    } catch (err) {
      console.error('Delete error:', err);
      alert('שגיאה במחיקת ההזמנה');
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDetailsOrderId || !newMessageText.trim()) return;

    setSendingMsg(true);
    try {
      const msg: ChatMessage = {
        user: currentDisplayName,
        text: newMessageText.trim(),
        timestamp: Date.now(),
      };
      const docRef = doc(db, ...ORDERS_PATH, activeDetailsOrderId);
      await updateDoc(docRef, {
        messages: arrayUnion(msg),
      });
      setNewMessageText('');
    } catch (err) {
      console.error('Chat send error:', err);
      alert('שגיאה בשליחת ההודעה');
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
    a.download = `ceramiso-orders-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isAdmin) return;
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const importedOrders: Order[] = JSON.parse(text);
      if (!Array.isArray(importedOrders)) throw new Error('Invalid format');

      for (const ord of importedOrders) {
        const { id, ...rest } = ord;
        const docRef = doc(db, ...ORDERS_PATH, id || `imp_${Date.now()}_${Math.random()}`);
        await setDoc(docRef, rest, { merge: true });
      }
      alert(`שוחזרו בהצלחה ${importedOrders.length} הזמנות!`);
    } catch {
      alert('קובץ הגיבוי אינו תקין.');
    }
    e.target.value = '';
  };

  // --- Loading Screen ---
  if (authLoading) {
    return (
      <div dir="rtl" className="min-h-screen bg-stone-900 flex items-center justify-center text-white">
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl bg-amber-500 text-stone-950 font-bold text-2xl flex items-center justify-center mx-auto mb-3 animate-pulse">
            ק
          </div>
          <p className="text-sm text-stone-300">טוען מערכת מאובטחת...</p>
        </div>
      </div>
    );
  }

  // --- Secure Login Screen ---
  if (!authUser) {
    return (
      <div dir="rtl" className="min-h-screen bg-stone-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl max-w-md w-full p-8 shadow-2xl">
          <div className="text-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-amber-500 flex items-center justify-center text-stone-950 font-bold text-3xl mx-auto shadow-md mb-4">
              ק
            </div>
            <h1 className="text-2xl font-bold text-stone-900">קרמיסו - ניהול הזמנות יבוא</h1>
            <p className="text-stone-500 text-sm mt-1">גישה מאובטחת לעובדי החברה בלבד</p>
          </div>

          {loginError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-3 rounded-xl mb-4 text-center">
              {loginError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1.5">
                כתובת אימייל
              </label>
              <div className="relative">
                <Mail className="w-5 h-5 text-stone-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  dir="ltr"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="name@ceramiso.co.il"
                  className="w-full pr-11 pl-4 py-3 border border-stone-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none text-stone-900 text-left"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1.5">סיסמה</label>
              <div className="relative">
                <Lock className="w-5 h-5 text-stone-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  dir="ltr"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pr-11 pl-4 py-3 border border-stone-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none text-stone-900 text-left"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-stone-300 text-amber-500 focus:ring-amber-500"
                />
                <span className="text-sm text-stone-700">זכור אותי במכשיר זה</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={loggingIn}
              className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold rounded-xl shadow transition disabled:opacity-50 cursor-pointer"
            >
              {loggingIn ? 'מתחבר...' : 'התחברות למערכת'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const filteredOrders = orders.filter((order) => {
    const matchesSearch =
      order.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.orderNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.modelName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.supplier.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'הכל' || order.status === statusFilter;
    const matchesType = typeFilter === 'הכל' || order.orderType === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  });

  const activeDetailsOrder = orders.find((o) => o.id === activeDetailsOrderId) || null;

  return (
    <div dir="rtl" className="min-h-screen bg-stone-100 text-stone-800 pb-12">
      {/* Header */}
      <header className="bg-stone-900 text-white shadow-lg sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center text-stone-950 font-bold text-xl shadow">
              ק
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg sm:text-xl font-bold tracking-tight">
                  קרמיסו - ניהול הזמנות יבוא
                </h1>
                {isAdmin && (
                  <span className="inline-flex items-center gap-1 text-[11px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-semibold">
                    <ShieldCheck className="w-3 h-3" /> מנהל מערכת
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-stone-400">
                <span className="inline-flex items-center gap-1 text-stone-200 font-medium">
                  <User className="w-3.5 h-3.5 text-amber-400" />
                  {currentDisplayName} ({authUser.email})
                </span>
                <span>•</span>
                <button
                  onClick={handleLogout}
                  className="inline-flex items-center gap-1 hover:text-white underline cursor-pointer"
                >
                  <LogOut className="w-3 h-3" />
                  התנתק
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => setIsAdminModalOpen(true)}
                  className="flex items-center gap-1.5 bg-stone-800 hover:bg-stone-700 text-amber-300 text-xs font-semibold px-3 py-2.5 rounded-xl border border-stone-700 transition cursor-pointer"
                >
                  <Users className="w-4 h-4" />
                  <span>ניהול משתמשים והתראות</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportBackup}
                  title="הורד קובץ גיבוי"
                  className="flex items-center gap-1 bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-medium px-2.5 py-2.5 rounded-xl border border-stone-700 transition cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => importInputRef.current?.click()}
                  title="שחזר מקובץ גיבוי"
                  className="flex items-center gap-1 bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-medium px-2.5 py-2.5 rounded-xl border border-stone-700 transition cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                </button>
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleImportBackup}
                  className="hidden"
                />
              </>
            )}

            <button
              onClick={openNewModal}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold px-4 py-2.5 rounded-xl shadow transition cursor-pointer"
            >
              <PlusCircle className="w-5 h-5" />
              <span>הזמנה חדשה</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 mt-6">
        {/* Search & Filter Bar */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-stone-200 space-y-3 mb-6">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-5 h-5 text-stone-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="חיפוש לפי שם לקוח, מספר הזמנה, דגם או ספק..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pr-10 pl-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            {/* Type Filter: הכל / B2B / מלאי */}
            <div className="flex gap-1.5 bg-stone-100 p-1 rounded-xl">
              {['הכל', 'B2B', 'מלאי'].map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    typeFilter === t
                      ? 'bg-amber-500 text-stone-950 shadow-2xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {['הכל', ...STATUS_OPTIONS].map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                  statusFilter === status
                    ? 'bg-stone-900 text-white shadow-sm'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Orders Grid */}
        {filteredOrders.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-stone-200 shadow-sm">
            <Package className="w-12 h-12 text-stone-300 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-stone-700">לא נמצאו הזמנות</h3>
            <p className="text-stone-500 text-sm mt-1">לחץ על "הזמנה חדשה" כדי להוסיף הזמנה למערכת</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredOrders.map((order) => {
              const style = STATUS_STYLES[order.status] || STATUS_STYLES['הוזמן מספק'];
              const msgCount = order.messages?.length || 0;
              const logCount = order.logs?.length || 0;

              return (
                <div
                  key={order.id}
                  className="bg-white rounded-2xl border border-stone-200 shadow-sm hover:shadow-md transition flex flex-col justify-between overflow-hidden"
                >
                  <div>
                    {/* Card Top Bar */}
                    <div className="p-4 border-b border-stone-100 flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${
                              order.orderType === 'B2B'
                                ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                                : 'bg-stone-100 border-stone-300 text-stone-700'
                            }`}
                          >
                            {order.orderType === 'B2B' ? (
                              <Building2 className="w-3.5 h-3.5" />
                            ) : (
                              <Layers className="w-3.5 h-3.5" />
                            )}
                            {order.orderType}
                          </span>

                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${style.bg} ${style.text}`}
                          >
                            {style.icon}
                            {order.status}
                          </span>
                        </div>

                        {order.orderType === 'B2B' ? (
                          <div className="mt-2.5">
                            <h3 className="text-lg font-bold text-stone-900">
                              {order.customerName}
                            </h3>
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md mt-0.5">
                              <Hash className="w-3 h-3" />
                              הזמנה: {order.orderNumber}
                            </span>
                          </div>
                        ) : (
                          <h3 className="text-lg font-bold text-stone-900 mt-2.5">
                            הזמנת מלאי
                          </h3>
                        )}
                      </div>

                      {/* Edit (All) & Delete (Admin Only) */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEditModal(order)}
                          title="ערוך הזמנה"
                          className="p-2 text-stone-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition cursor-pointer"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => handleDelete(order)}
                            title="מחק הזמנה (מנהל בלבד)"
                            className="p-2 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Card Details */}
                    <div className="p-4 space-y-2.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-stone-500">דגם / מק״ט:</span>
                        <span className="font-semibold text-stone-900">{order.modelName}</span>
                      </div>
                      {order.quantity && (
                        <div className="flex justify-between">
                          <span className="text-stone-500">כמות / מ״ר:</span>
                          <span className="font-medium text-stone-800">{order.quantity}</span>
                        </div>
                      )}
                      {order.supplier && (
                        <div className="flex justify-between">
                          <span className="text-stone-500">ספק / מפעל:</span>
                          <span className="font-medium text-stone-800">{order.supplier}</span>
                        </div>
                      )}
                      {order.eta && (
                        <div className="flex justify-between items-center">
                          <span className="text-stone-500 flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" /> צפי הגעה:
                          </span>
                          <span className="font-medium text-stone-800">{order.eta}</span>
                        </div>
                      )}
                      {order.notes && (
                        <div className="bg-stone-50 p-2.5 rounded-xl text-xs text-stone-600 border border-stone-100 flex items-start gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-stone-400 shrink-0 mt-0.5" />
                          <span>{order.notes}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    {/* Images Gallery Preview */}
                    {order.images && order.images.length > 0 && (
                      <div className="px-4 pb-3">
                        <p className="text-xs font-medium text-stone-500 mb-2 flex items-center gap-1">
                          <ImageIcon className="w-3.5 h-3.5" />
                          תמונות מצורפות ({order.images.length})
                        </p>
                        <div className="grid grid-cols-3 gap-2">
                          {order.images.map((imgSrc, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setLightboxImage(imgSrc)}
                              className="relative group aspect-square rounded-xl overflow-hidden border border-stone-200 bg-stone-100 cursor-pointer"
                            >
                              <img
                                src={imgSrc}
                                alt={`תמונה ${idx + 1}`}
                                className="w-full h-full object-cover group-hover:scale-105 transition"
                              />
                              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                                <ZoomIn className="w-5 h-5 text-white" />
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Chat & Logs Buttons */}
                    <div className="px-4 pb-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveDetailsOrderId(order.id);
                          setActiveTab('chat');
                        }}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 bg-stone-100 hover:bg-stone-200 text-stone-700 font-medium text-xs rounded-xl transition cursor-pointer"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-amber-600" />
                        <span>התכתבות ({msgCount})</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveDetailsOrderId(order.id);
                          setActiveTab('logs');
                        }}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 bg-stone-100 hover:bg-stone-200 text-stone-700 font-medium text-xs rounded-xl transition cursor-pointer"
                      >
                        <History className="w-3.5 h-3.5 text-blue-600" />
                        <span>לוג עריכות ({logCount})</span>
                      </button>
                    </div>

                    {/* Quick Confirm "התקבל" Button (Admin Only) */}
                    {isAdmin && order.status !== 'נמסר ללקוח' && (
                      <div className="px-4 pb-4">
                        <button
                          type="button"
                          onClick={() => handleConfirmReceived(order)}
                          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm rounded-xl shadow-xs transition cursor-pointer"
                        >
                          <Check className="w-4 h-4" />
                          <span>התקבל (אישור אספקה)</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Add / Edit Order Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden my-8">
            <div className="bg-stone-900 text-white px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">
                {editingOrder ? 'עריכת הזמנה קיימת' : 'הוספת הזמנה חדשה'}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-stone-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              {/* Mandatory Order Type Selector: B2B vs מלאי */}
              <div>
                <label className="block text-xs font-semibold text-stone-600 mb-1.5">
                  סוג הזמנה (חובה לבחור) *
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, orderType: 'B2B' })}
                    className={`py-2.5 px-4 rounded-xl border-2 font-bold text-sm flex items-center justify-center gap-2 transition cursor-pointer ${
                      formData.orderType === 'B2B'
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-800'
                        : 'border-stone-200 bg-stone-50 text-stone-600 hover:bg-stone-100'
                    }`}
                  >
                    <Building2 className="w-4 h-4" />
                    <span>B2B (לקוח)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, orderType: 'מלאי' })}
                    className={`py-2.5 px-4 rounded-xl border-2 font-bold text-sm flex items-center justify-center gap-2 transition cursor-pointer ${
                      formData.orderType === 'מלאי'
                        ? 'border-amber-500 bg-amber-50 text-amber-900'
                        : 'border-stone-200 bg-stone-50 text-stone-600 hover:bg-stone-100'
                    }`}
                  >
                    <Layers className="w-4 h-4" />
                    <span>מלאי</span>
                  </button>
                </div>
              </div>

              {/* Conditional Mandatory Fields for B2B */}
              {formData.orderType === 'B2B' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-indigo-50/60 p-3.5 rounded-xl border border-indigo-100">
                  <div>
                    <label className="block text-xs font-semibold text-indigo-900 mb-1">
                      שם לקוח *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.customerName}
                      onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                      className="w-full px-3 py-2 bg-white border border-indigo-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      placeholder="שם הלקוח / הפרויקט"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-indigo-900 mb-1">
                      מספר הזמנה *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.orderNumber}
                      onChange={(e) => setFormData({ ...formData, orderNumber: e.target.value })}
                      className="w-full px-3 py-2 bg-white border border-indigo-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      placeholder="לדוגמה: 10452"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-stone-600 mb-1">
                    דגם / מק״ט קרמיקה *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.modelName}
                    onChange={(e) => setFormData({ ...formData, modelName: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    placeholder="גרניט פורצלן 120x60"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-600 mb-1">כמות / מ״ר</label>
                  <input
                    type="text"
                    value={formData.quantity}
                    onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    placeholder="45 מ״ר / 30 קרטונים"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-stone-600 mb-1">סטטוס הזמנה</label>
                  <select
                    value={formData.status}
                    onChange={(e) =>
                      setFormData({ ...formData, status: e.target.value as Order['status'] })
                    }
                    className="w-full px-3 py-2 border border-stone-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none bg-white"
                  >
                    {STATUS_OPTIONS.filter((st) => isAdmin || st !== 'נמסר ללקוח').map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-600 mb-1">ספק / יבואן</label>
                  <input
                    type="text"
                    value={formData.supplier}
                    onChange={(e) => setFormData({ ...formData, supplier: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    placeholder="איטליה / ספרד"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-600 mb-1">צפי הגעה</label>
                  <input
                    type="date"
                    value={formData.eta}
                    onChange={(e) => setFormData({ ...formData, eta: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-600 mb-1">הערות</label>
                <textarea
                  rows={2}
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  placeholder="פרטים נוספים, גוון, סדרה..."
                />
              </div>

              {/* Multi-Image Upload Section */}
              <div>
                <label className="block text-xs font-semibold text-stone-600 mb-1.5">
                  תמונות הדגם / תעודות (ניתן לבחור כמה תמונות יחד)
                </label>
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-stone-300 hover:border-amber-500 rounded-xl p-4 cursor-pointer bg-stone-50 transition">
                  <ImageIcon className="w-6 h-6 text-stone-400 mb-1" />
                  <span className="text-xs font-medium text-stone-600">
                    לחץ כאן לבחירת תמונות מהמחשב או מהגלריה בנייד
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                </label>

                {formData.images.length > 0 && (
                  <div className="grid grid-cols-4 gap-2 mt-3">
                    {formData.images.map((img, idx) => (
                      <div
                        key={idx}
                        className="relative aspect-square rounded-lg overflow-hidden border border-stone-200"
                      >
                        <img src={img} alt="" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removeImageFromForm(idx)}
                          className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-0.5 shadow hover:bg-red-700 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-stone-600 hover:bg-stone-100 cursor-pointer"
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl text-sm font-bold bg-amber-500 hover:bg-amber-400 text-stone-950 shadow disabled:opacity-50 cursor-pointer"
                >
                  {saving ? 'שומר...' : editingOrder ? 'שמור שינויים' : 'צור הזמנה ושלח מייל'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Panel Modal: User Management & Email Notification Settings */}
      {isAdmin && isAdminModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden my-8">
            <div className="bg-stone-900 text-white px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-amber-400" />
                <h2 className="text-lg font-bold">ניהול משתמשים והגדרות מנהל</h2>
              </div>
              <button
                onClick={() => setIsAdminModalOpen(false)}
                className="text-stone-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6 max-h-[82vh] overflow-y-auto">
              {/* Section 1: Notification Email on New Order */}
              <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4">
                <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2 mb-2">
                  <Mail className="w-4 h-4 text-amber-600" />
                  אימייל לקבלת התראה בעת הוספת הזמנה חדשה
                </h3>
                <form onSubmit={handleSaveNotificationEmail} className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="email"
                    required
                    dir="ltr"
                    value={adminEmailInput}
                    onChange={(e) => setAdminEmailInput(e.target.value)}
                    placeholder="izak@ceramiso.co.il"
                    className="flex-1 px-3.5 py-2 bg-white border border-amber-300 rounded-xl text-sm text-left focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-bold rounded-xl transition cursor-pointer"
                  >
                    {savingSettings ? 'שומר...' : 'שמור אימייל'}
                  </button>
                </form>
              </div>

              {/* Section 2: Add New Employee User */}
              <div className="border border-stone-200 rounded-2xl p-4">
                <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2 mb-3">
                  <UserPlus className="w-4 h-4 text-emerald-600" />
                  הוספת משתמש חדש למערכת
                </h3>
                <form onSubmit={handleCreateUser} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <input
                    type="text"
                    required
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    placeholder="שם העובד (ללוג)"
                    className="px-3 py-2 border border-stone-300 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                  <input
                    type="email"
                    required
                    dir="ltr"
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    placeholder="user@ceramiso.co.il"
                    className="px-3 py-2 border border-stone-300 rounded-xl text-sm text-left focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    required
                    dir="ltr"
                    minLength={6}
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                    placeholder="סיסמה (מינ׳ 6 תווים)"
                    className="px-3 py-2 border border-stone-300 rounded-xl text-sm text-left focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={creatingUser}
                    className="sm:col-span-3 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-xl shadow-xs transition disabled:opacity-50 cursor-pointer"
                  >
                    {creatingUser ? 'יוצר משתמש...' : 'צור משתמש חדש'}
                  </button>
                </form>
              </div>

              {/* Section 3: Existing Users List */}
              <div>
                <h3 className="text-sm font-bold text-stone-900 mb-2.5">
                  משתמשים רשומים ({appUsers.length})
                </h3>
                {appUsers.length === 0 ? (
                  <p className="text-xs text-stone-500 bg-stone-50 p-4 rounded-xl text-center">
                    טרם נוספו עובדים נוספים מעבר למנהל המערכת ({ADMIN_EMAIL}).
                  </p>
                ) : (
                  <div className="space-y-2">
                    {appUsers.map((u) => (
                      <div
                        key={u.id}
                        className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2 ${
                          u.active
                            ? 'bg-white border-stone-200'
                            : 'bg-red-50/50 border-red-200 opacity-75'
                        }`}
                      >
                        <div>
                          {editingUserId === u.id ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={editUserNameValue}
                                onChange={(e) => setEditUserNameValue(e.target.value)}
                                className="px-2 py-1 border border-stone-300 rounded-lg text-xs"
                              />
                              <button
                                onClick={() => handleUpdateUserName(u.id)}
                                className="px-2 py-1 bg-emerald-600 text-white text-xs rounded-lg cursor-pointer"
                              >
                                שמור
                              </button>
                              <button
                                onClick={() => setEditingUserId(null)}
                                className="px-2 py-1 bg-stone-200 text-xs rounded-lg cursor-pointer"
                              >
                                ביטול
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-stone-900">{u.name}</span>
                              {!u.active && (
                                <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold">
                                  מושבת
                                </span>
                              )}
                            </div>
                          )}
                          <p className="text-xs text-stone-500" dir="ltr">
                            {u.email}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingUserId(u.id);
                              setEditUserNameValue(u.name);
                            }}
                            title="ערוך שם"
                            className="p-1.5 text-stone-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg cursor-pointer"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleResetUserPassword(u.email)}
                            title="שלח מייל איפוס סיסמה"
                            className="p-1.5 text-stone-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg cursor-pointer"
                          >
                            <KeyRound className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleUserActive(u)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                              u.active
                                ? 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {u.active ? 'השבת' : 'הפעל'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteUserRecord(u)}
                            title="מחק משתמש"
                            className="p-1.5 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chat & Activity Logs Modal */}
      {activeDetailsOrder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="bg-stone-900 text-white px-5 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold">
                  {activeDetailsOrder.orderType === 'B2B'
                    ? `${activeDetailsOrder.customerName} (#${activeDetailsOrder.orderNumber})`
                    : `הזמנת מלאי - ${activeDetailsOrder.modelName}`}
                </h2>
                <p className="text-xs text-stone-400">{activeDetailsOrder.modelName}</p>
              </div>
              <button
                onClick={() => setActiveDetailsOrderId(null)}
                className="text-stone-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex border-b border-stone-200 bg-stone-50">
              <button
                type="button"
                onClick={() => setActiveTab('chat')}
                className={`flex-1 py-3 text-sm font-semibold flex items-center justify-center gap-2 border-b-2 transition cursor-pointer ${
                  activeTab === 'chat'
                    ? 'border-amber-500 text-stone-900 bg-white'
                    : 'border-transparent text-stone-500 hover:text-stone-700'
                }`}
              >
                <MessageSquare className="w-4 h-4 text-amber-600" />
                <span>התכתבות צוות ({activeDetailsOrder.messages?.length || 0})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('logs')}
                className={`flex-1 py-3 text-sm font-semibold flex items-center justify-center gap-2 border-b-2 transition cursor-pointer ${
                  activeTab === 'logs'
                    ? 'border-blue-500 text-stone-900 bg-white'
                    : 'border-transparent text-stone-500 hover:text-stone-700'
                }`}
              >
                <History className="w-4 h-4 text-blue-600" />
                <span>לוג עריכות ({activeDetailsOrder.logs?.length || 0})</span>
              </button>
            </div>

            {activeTab === 'chat' ? (
              <>
                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-stone-50 min-h-[250px]">
                  {!activeDetailsOrder.messages || activeDetailsOrder.messages.length === 0 ? (
                    <div className="text-center text-stone-400 text-sm py-10">
                      אין עדיין הודעות בהזמנה זו. כתוב הודעה ראשונה למטה.
                    </div>
                  ) : (
                    activeDetailsOrder.messages.map((msg, idx) => {
                      const isMe = msg.user === currentDisplayName;
                      return (
                        <div
                          key={idx}
                          className={`flex flex-col ${isMe ? 'items-start' : 'items-end'}`}
                        >
                          <div
                            className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 shadow-xs ${
                              isMe
                                ? 'bg-amber-100 text-stone-900 rounded-tr-xs'
                                : 'bg-white border border-stone-200 text-stone-800 rounded-tl-xs'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3 mb-1">
                              <span className="text-xs font-bold text-stone-700">{msg.user}</span>
                              <span className="text-[10px] text-stone-400">
                                {formatDateTime(msg.timestamp)}
                              </span>
                            </div>
                            <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <form
                  onSubmit={handleSendMessage}
                  className="p-3 bg-white border-t border-stone-200 flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={newMessageText}
                    onChange={(e) => setNewMessageText(e.target.value)}
                    placeholder={`כתוב הודעה בשם ${currentDisplayName}...`}
                    className="flex-1 px-3.5 py-2.5 bg-stone-100 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <button
                    type="submit"
                    disabled={sendingMsg || !newMessageText.trim()}
                    className="p-2.5 bg-amber-500 hover:bg-amber-400 text-stone-950 rounded-xl shadow disabled:opacity-40 transition cursor-pointer"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </form>
              </>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-2.5 bg-stone-50 min-h-[250px]">
                {!activeDetailsOrder.logs || activeDetailsOrder.logs.length === 0 ? (
                  <div className="text-center text-stone-400 text-sm py-10">
                    אין עדיין היסטוריית פעולות מתועדת להזמנה זו.
                  </div>
                ) : (
                  [...activeDetailsOrder.logs].reverse().map((log, idx) => (
                    <div
                      key={idx}
                      className="bg-white p-3 rounded-xl border border-stone-200 shadow-2xs flex items-start justify-between gap-2"
                    >
                      <div>
                        <span className="inline-block text-xs font-bold text-stone-900 bg-stone-100 px-2 py-0.5 rounded-md mb-1">
                          {log.user}
                        </span>
                        <p className="text-xs text-stone-700">{log.action}</p>
                      </div>
                      <span className="text-[11px] text-stone-400 whitespace-nowrap">
                        {formatDateTime(log.timestamp)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Fullscreen Image Lightbox */}
      {lightboxImage && (
        <div
          onClick={() => setLightboxImage(null)}
          className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4 cursor-zoom-out"
        >
          <button
            onClick={() => setLightboxImage(null)}
            className="absolute top-5 right-5 text-white bg-white/10 hover:bg-white/20 p-2 rounded-full cursor-pointer"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={lightboxImage}
            alt="תצוגה מוגדלת"
            className="max-w-full max-h-[90vh] rounded-xl shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}