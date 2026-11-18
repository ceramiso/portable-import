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
  Settings,
  Mail
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
  canChangeStatus: boolean;
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

  // Admin Modal State
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [activeAdminTab, setActiveAdminTab] = useState<'users' | 'email'>('users');
  const [newStaffUsername, setNewStaffUsername] = useState('');
  const [newStaffPassword, setNewStaffPassword] = useState('');
  const [newStaffCanChangeStatus, setNewStaffCanChangeStatus] = useState(false);
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
  const currentDisplayName = loggedInUser
    ? loggedInUser.isAdmin
      ? `${loggedInUser.username} (מנהל)`
      : loggedInUser.username
    : '';

  // בדיקת הרשאות לשינוי סטטוס
  const currentUserRecord = staffList.find(s => s.username.toLowerCase() === loggedInUser?.username.toLowerCase());
  const hasStatusPermission = isAdmin || Boolean(currentUserRecord?.canChangeStatus);

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
          canChangeStatus: data.canChangeStatus === true,
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

  useEffect(() => {
    if (loggedInUser && !loggedInUser.isAdmin && staffList.length > 0) {
      const found = staffList.find(
        (s) => s.username.toLowerCase() === loggedInUser.username.toLowerCase()
      );
      if (!found || !found.active) {
        handleLogout();
      }
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
    const { notificationEmail, emailjsServiceId, emailjsTemplateId, emailjsPublicKey } = settings;
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

  // --- Admin Authorized Staff Management ---
  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    if (!newStaffUsername.trim() || !newStaffPassword.trim()) {
      alert('נא למלא שם משתמש וסיסמה');
      return;
    }

    const uLower = newStaffUsername.trim().toLowerCase();
    if (
      uLower === DEFAULT_ADMIN_USERNAME.toLowerCase() ||
      staffList.some((s) => s.username.toLowerCase() === uLower)
    ) {
      alert('שם משתמש זה כבר קיים במערכת.');
      return;
    }

    setCreatingStaff(true);
    try {
      await addDoc(collection(db, ...STAFF_PATH), {
        username: newStaffUsername.trim(),
        password: newStaffPassword.trim(),
        active: true,
        canChangeStatus: newStaffCanChangeStatus,
        createdAt: Date.now(),
      });
      setNewStaffUsername('');
      setNewStaffPassword('');
      setNewStaffCanChangeStatus(false);
    } catch {
      alert('שגיאה בהוספת המשתמש לרשימת המורשים');
    } finally {
      setCreatingStaff(false);
    }
  };

  const handleToggleStaffActive = async (staff: StaffRecord) => {
    if (!isAdmin) return;
    try {
      await updateDoc(doc(db, ...STAFF_PATH, staff.id), { active: !staff.active });
    } catch {
      alert('שגיאה בשינוי סטטוס המשתמש');
    }
  };

  const handleToggleStaffStatusPermission = async (staff: StaffRecord) => {
    if (!isAdmin) return;
    try {
      await updateDoc(doc(db, ...STAFF_PATH, staff.id), { canChangeStatus: !staff.canChangeStatus });
    } catch {
      alert('שגיאה בעדכון הרשאות המשתמש');
    }
  };

  const handleDeleteStaff = async (staff: StaffRecord) => {
    if (!isAdmin) return;
    const ok = window.confirm(`האם למחוק לצמיתות את "${staff.username}" מרשימת המורשים?`);
    if (!ok) return;
    try {
      await deleteDoc(doc(db, ...STAFF_PATH, staff.id));
    } catch {
      alert('שגיאה במחיקת המשתמש');
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
    if (oldOrder.orderType !== newData.orderType) changes.push(`סוג הזמנה`);
    if (oldOrder.customerName !== newData.customerName) changes.push(`שם לקוח`);
    if (oldOrder.orderNumber !== newData.orderNumber) changes.push(`מספר הזמנה`);
    if (oldOrder.modelName !== newData.modelName) changes.push(`דגם`);
    if (oldOrder.quantity !== newData.quantity) changes.push(`כמות`);
    if (oldOrder.supplier !== newData.supplier) changes.push(`ספק`);
    if (Boolean(oldOrder.isOrdered) !== Boolean(newData.isOrdered))
      changes.push(`סטטוס הזמנה (${newData.isOrdered ? 'הוזמן' : 'לא הוזמן'})`);
    if (oldOrder.eta !== newData.eta) changes.push(`צפי הגעה`);
    if (oldOrder.notes !== newData.notes) changes.push(`הערות`);
    return changes.length > 0 ? `ערך: ${changes.join(', ')}` : 'שמר עריכה ללא שינוי שדות';
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.modelName.trim()) {
      alert('נא למלא דגם / מק״ט קרמיקה');
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
    } catch (err) {
      console.error('Save error:', err);
      alert('שגיאה בשמירה לענן.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleOrderedQuick = async (order: Order) => {
    if (!hasStatusPermission) {
      alert('אין לך הרשאה לשנות סטטוס הזמנה. פנה למנהל המערכת.');
      return;
    }
    if (!window.confirm('האם אתה בטוח שברצונך לשנות סטטוס הזמנה?')) return;
    
    const nextVal = !order.isOrdered;
    try {
      const logEntry: LogEntry = {
        user: currentDisplayName,
        action: nextVal ? 'סימן V: הוזמן מהספק' : 'ביטל סימון הוזמן',
        timestamp: Date.now(),
      };
      await updateDoc(doc(db, ...ORDERS_PATH, order.id), {
        isOrdered: nextVal,
        logs: arrayUnion(logEntry),
      });
    } catch {
      alert('שגיאה בעדכון סטטוס הזמנה');
    }
  };

  const handleConfirmReceived = async (order: Order) => {
    if (!hasStatusPermission) {
      alert('אין לך הרשאה לאשר קבלת הזמנה. פנה למנהל המערכת.');
      return;
    }
    if (!window.confirm('האם אתה בטוח שההזמנה התקבלה וסופקה?')) return;

    try {
      const logEntry: LogEntry = {
        user: currentDisplayName,
        action: 'אישר אספקה ומסירה ("התקבל")',
        timestamp: Date.now(),
      };
      await updateDoc(doc(db, ...ORDERS_PATH, order.id), {
        isReceived: true,
        isOrdered: true,
        logs: arrayUnion(logEntry),
      });
    } catch (err) {
      console.error('Status update error:', err);
      alert('שגיאה באישור ההזמנה');
    }
  };

  const handleDelete = async (order: Order) => {
    if (!isAdmin) return;
    const confirmed = window.confirm('האם למחוק לצמיתות את ההזמנה?');
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, ...ORDERS_PATH, order.id));
      if (activeDetailsOrderId === order.id) setActiveDetailsOrderId(null);
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
      await updateDoc(doc(db, ...ORDERS_PATH, activeDetailsOrderId), {
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
    const blob = new Blob([JSON.stringify(orders, null, 2)], { type: 'application/json' });
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
        await setDoc(doc(db, ...ORDERS_PATH, id || `imp_${Date.now()}_${Math.random()}`), rest, { merge: true });
      }
      alert(`שוחזרו בהצלחה ${importedOrders.length} הזמנות!`);
    } catch {
      alert('קובץ הגיבוי אינו תקין.');
    }
    e.target.value = '';
  };

  if (connecting) {
    return (
      <div dir="rtl" className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-700">
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl bg-slate-900 text-amber-400 font-bold text-2xl flex items-center justify-center mx-auto mb-3 animate-pulse">C</div>
          <p className="text-sm font-medium text-slate-500">טוען את מערכת קרמיסו...</p>
        </div>
      </div>
    );
  }

  if (!loggedInUser) {
    return (
      <div dir="rtl" className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-slate-100 flex items-center justify-center p-4">
        <div className="bg-white/95 backdrop-blur-md rounded-3xl max-w-md w-full p-6 sm:p-10 shadow-xl border border-slate-200/80">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-slate-900 flex items-center justify-center text-amber-400 font-bold text-2xl mx-auto shadow-md mb-4">C</div>
            <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-amber-600 block mb-1">CERAMISO IMPORT PORTAL</span>
            <h1 className="text-2xl font-bold text-slate-900">ניהול הזמנות יבוא</h1>
          </div>
          {loginError && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs p-3.5 rounded-2xl mb-5 text-center">{loginError}</div>}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">שם משתמש</label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                <input type="text" required autoFocus value={usernameInput} onChange={(e) => setUsernameInput(e.target.value)} className="w-full pr-10 pl-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:bg-white focus:outline-none focus:border-slate-400" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">סיסמה</label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                <input type="password" required dir="ltr" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} className="w-full pr-10 pl-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:bg-white focus:outline-none focus:border-slate-400 text-left" />
              </div>
            </div>
            <button type="submit" className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm rounded-2xl shadow-sm transition mt-2">כניסה למערכת</button>
          </form>
        </div>
      </div>
    );
  }

  const totalCount = orders.length;
  const notOrderedCount = orders.filter((o) => !o.isOrdered && !o.isReceived).length;
  const orderedCount = orders.filter((o) => o.isOrdered && !o.isReceived).length;
  const receivedCount = orders.filter((o) => o.isReceived).length;

  const filteredOrders = orders.filter((order) => {
    const matchesSearch =
      order.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.orderNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.modelName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.supplier.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus =
      statusFilter === 'הכל' ||
      (statusFilter === 'לא הוזמן' && !order.isOrdered && !order.isReceived) ||
      (statusFilter === 'הוזמן' && order.isOrdered && !order.isReceived) ||
      (statusFilter === 'התקבל' && order.isReceived);
    const matchesType = typeFilter === 'הכל' || order.orderType === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  });

  const activeDetailsOrder = orders.find((o) => o.id === activeDetailsOrderId) || null;

  return (
    <div dir="rtl" className="min-h-screen bg-[#F8F9FA] text-slate-800 pb-16 antialiased">
      {/* Header */}
      <header className="bg-white/90 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-amber-400 font-bold text-lg">C</div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold text-slate-900">קרמיסו • הזמנות יבוא</h1>
                {isAdmin && <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-semibold"><ShieldCheck className="w-3 h-3" /> מנהל</span>}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                <span className="font-medium">{currentDisplayName}</span>
                <span className="text-slate-300">•</span>
                <button onClick={handleLogout} className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-800">
                  <LogOut className="w-3 h-3" /> <span>התנתק</span>
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && (
              <>
                <button onClick={() => setIsAdminModalOpen(true)} className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold px-3 py-2 sm:px-3.5 sm:py-2.5 rounded-xl transition">
                  <Settings className="w-4 h-4" /> <span className="hidden sm:inline">הגדרות מנהל</span>
                </button>
                <button onClick={handleExportBackup} title="גיבוי" className="p-2 sm:p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition"><Download className="w-4 h-4" /></button>
                <button onClick={() => importInputRef.current?.click()} title="שחזור" className="p-2 sm:p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition"><Upload className="w-4 h-4" /></button>
                <input ref={importInputRef} type="file" accept=".json" onChange={handleImportBackup} className="hidden" />
              </>
            )}
            <button onClick={openNewModal} className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs sm:text-sm px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl shadow-xs transition">
              <Plus className="w-4 h-4 text-amber-400" /> <span>הזמנה חדשה</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 mt-6">
        {/* KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'כל ההזמנות', value: totalCount, filter: 'הכל', color: 'text-slate-900' },
            { label: 'ממתינות להזמנה', value: notOrderedCount, filter: 'לא הוזמן', color: 'text-amber-600' },
            { label: 'הוזמנו מספק', value: orderedCount, filter: 'הוזמן', color: 'text-blue-600' },
            { label: 'התקבלו וסופקו', value: receivedCount, filter: 'התקבל', color: 'text-emerald-600' },
          ].map((stat) => (
            <button key={stat.filter} onClick={() => setStatusFilter(stat.filter)} className={`text-right p-3.5 sm:p-4 rounded-2xl border transition ${statusFilter === stat.filter ? 'bg-white border-slate-900/20 shadow-sm ring-1 ring-slate-900/10' : 'bg-white/70 hover:bg-white border-slate-200/70'}`}>
              <span className="text-[11px] sm:text-xs font-medium text-slate-500 block">{stat.label}</span>
              <span className={`text-xl sm:text-2xl font-bold mt-1 block ${stat.color}`}>{stat.value}</span>
            </button>
          ))}
        </div>

        {/* Filter Bar */}
        <div className="bg-white p-3 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input type="text" placeholder="חיפוש חופשי..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pr-9 pl-4 py-2 bg-slate-50 border border-transparent focus:border-slate-300 focus:bg-white rounded-xl text-sm outline-none transition" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex bg-slate-100 p-1 rounded-xl">
              {['הכל', 'B2B', 'מלאי'].map((t) => (
                <button key={t} onClick={() => setTypeFilter(t)} className={`px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition ${typeFilter === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{t}</button>
              ))}
            </div>
            <div className="flex bg-slate-100 p-1 rounded-xl overflow-x-auto">
              {['הכל', 'לא הוזמן', 'הוזמן', 'התקבל'].map((status) => (
                <button key={status} onClick={() => setStatusFilter(status)} className={`px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold whitespace-nowrap transition ${statusFilter === status ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>{status}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Orders Grid */}
        {filteredOrders.length === 0 ? (
          <div className="bg-white rounded-3xl p-12 sm:p-16 text-center border border-slate-200">
            <Package className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-bold text-slate-800">לא נמצאו הזמנות</h3>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredOrders.map((order) => (
              <div key={order.id} className="bg-white rounded-2xl border border-slate-200 flex flex-col justify-between overflow-hidden shadow-sm hover:shadow-md transition">
                <div>
                  <div className="px-5 pt-5 pb-3 flex items-start justify-between">
                    <div>
                      <div className="flex flex-wrap gap-1.5">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-bold ${order.orderType === 'B2B' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>
                          {order.orderType === 'B2B' ? <Building2 className="w-3 h-3 text-amber-400" /> : <Layers className="w-3 h-3 text-slate-500" />} {order.orderType}
                        </span>
                        {order.isReceived ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700"><CheckCircle2 className="w-3 h-3" /> התקבל</span>
                        ) : order.isOrdered ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700"><ShoppingBag className="w-3 h-3" /> הוזמן</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700"><Clock className="w-3 h-3" /> טרם הוזמן</span>
                        )}
                      </div>
                      <h3 className="text-sm sm:text-base font-bold text-slate-900 mt-2">{order.orderType === 'B2B' ? order.customerName : 'הזמנת מלאי'}</h3>
                    </div>
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => openEditModal(order)} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-xl"><Edit3 className="w-4 h-4" /></button>
                      {isAdmin && <button onClick={() => handleDelete(order)} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl"><Trash2 className="w-4 h-4" /></button>}
                    </div>
                  </div>
                  <div className="px-5 py-3 border-t border-slate-100 space-y-2 text-xs sm:text-sm">
                    <div className="flex justify-between gap-2"><span className="text-slate-400">דגם</span><span className="font-semibold">{order.modelName}</span></div>
                    {order.quantity && <div className="flex justify-between gap-2"><span className="text-slate-400">כמות</span><span className="font-medium">{order.quantity}</span></div>}
                    {order.supplier && <div className="flex justify-between gap-2"><span className="text-slate-400">ספק</span><span className="font-medium">{order.supplier}</span></div>}
                    {order.eta && <div className="flex justify-between gap-2"><span className="text-slate-400 flex items-center gap-1"><Calendar className="w-3 h-3"/> צפי</span><span className="font-medium">{order.eta}</span></div>}
                    {order.notes && <div className="mt-2 bg-slate-50 p-2 rounded-xl text-xs text-slate-600 flex gap-2"><FileText className="w-3 h-3 shrink-0" /><span>{order.notes}</span></div>}
                  </div>
                </div>
                <div className="px-5 pb-5 pt-2 space-y-3">
                  {order.images && order.images.length > 0 && (
                    <div className="grid grid-cols-4 gap-2">
                      {order.images.map((img, idx) => (
                        <button key={idx} onClick={() => setLightboxImage(img)} className="relative aspect-square rounded-xl overflow-hidden border border-slate-200">
                          <img src={img} className="w-full h-full object-cover" alt="img"/>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* כפתור "הוזמן מהספק" - רק למי שמורשה */}
                  {!order.isReceived && hasStatusPermission && (
                    <label className="flex items-center justify-between bg-slate-50 hover:bg-slate-100 border border-slate-200 px-3.5 py-2.5 rounded-xl cursor-pointer">
                      <span className="text-xs font-semibold text-slate-700">הוזמן מהספק</span>
                      <input type="checkbox" checked={Boolean(order.isOrdered)} onChange={() => handleToggleOrderedQuick(order)} className="w-4 h-4 rounded border-slate-300" />
                    </label>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => { setActiveDetailsOrderId(order.id); setActiveTab('chat'); }} className="flex items-center justify-center gap-1.5 py-2 bg-white text-slate-600 border border-slate-200 font-medium text-[11px] sm:text-xs rounded-xl hover:bg-slate-50"><MessageSquare className="w-3.5 h-3.5" /> הודעות</button>
                    <button onClick={() => { setActiveDetailsOrderId(order.id); setActiveTab('logs'); }} className="flex items-center justify-center gap-1.5 py-2 bg-white text-slate-600 border border-slate-200 font-medium text-[11px] sm:text-xs rounded-xl hover:bg-slate-50"><History className="w-3.5 h-3.5" /> היסטוריה</button>
                  </div>

                  {/* כפתור "התקבל וסופק" - רק למי שמורשה */}
                  {!order.isReceived && hasStatusPermission && (
                    <button onClick={() => handleConfirmReceived(order)} className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-emerald-600 text-white font-semibold text-xs rounded-xl hover:bg-emerald-500 transition">
                      <Check className="w-4 h-4" /> אישור התקבל וסופק
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Add / Edit Modal (Responsive) */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden my-4 sm:my-8 flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 sm:px-6 sm:py-5 border-b border-slate-100 flex items-center justify-between shrink-0">
              <h2 className="text-base sm:text-lg font-bold text-slate-900">{editingOrder ? 'עריכת פרטי הזמנה' : 'הזמנה חדשה'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSave} className="p-5 sm:p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1.5 rounded-2xl">
                <button type="button" onClick={() => setFormData({ ...formData, orderType: 'B2B' })} className={`py-2 px-2 rounded-xl font-bold text-xs flex justify-center gap-2 ${formData.orderType === 'B2B' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}><Building2 className="w-4 h-4" /> B2B</button>
                <button type="button" onClick={() => setFormData({ ...formData, orderType: 'מלאי' })} className={`py-2 px-2 rounded-xl font-bold text-xs flex justify-center gap-2 ${formData.orderType === 'מלאי' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}><Layers className="w-4 h-4" /> מלאי</button>
              </div>
              {formData.orderType === 'B2B' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                  <div><label className="block text-[11px] sm:text-xs font-semibold text-slate-700 mb-1">שם לקוח *</label><input type="text" required value={formData.customerName} onChange={(e) => setFormData({ ...formData, customerName: e.target.value })} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm" /></div>
                  <div><label className="block text-[11px] sm:text-xs font-semibold text-slate-700 mb-1">מספר הזמנה *</label><input type="text" required value={formData.orderNumber} onChange={(e) => setFormData({ ...formData, orderNumber: e.target.value })} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm" /></div>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="block text-[11px] sm:text-xs font-semibold text-slate-600 mb-1">דגם / מק״ט *</label><input type="text" required value={formData.modelName} onChange={(e) => setFormData({ ...formData, modelName: e.target.value })} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm" /></div>
                <div><label className="block text-[11px] sm:text-xs font-semibold text-slate-600 mb-1">כמות / מ״ר</label><input type="text" value={formData.quantity} onChange={(e) => setFormData({ ...formData, quantity: e.target.value })} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm" /></div>
                <div><label className="block text-[11px] sm:text-xs font-semibold text-slate-600 mb-1">ספק / יבואן</label><input type="text" value={formData.supplier} onChange={(e) => setFormData({ ...formData, supplier: e.target.value })} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm" /></div>
                <div><label className="block text-[11px] sm:text-xs font-semibold text-slate-600 mb-1">צפי הגעה</label><input type="date" value={formData.eta} onChange={(e) => setFormData({ ...formData, eta: e.target.value })} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm" /></div>
              </div>
              <label className="flex items-center justify-between bg-slate-50 border border-slate-200 p-3 rounded-2xl cursor-pointer">
                <span className="text-sm font-semibold">הוזמן מהספק</span>
                <input type="checkbox" checked={formData.isOrdered} onChange={(e) => setFormData({ ...formData, isOrdered: e.target.checked })} className="w-4 h-4 rounded border-slate-300" />
              </label>
              <div>
                <label className="block text-[11px] sm:text-xs font-semibold text-slate-600 mb-1">הערות</label>
                <textarea rows={2} value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm" />
              </div>
              <div>
                <label className="block text-[11px] sm:text-xs font-semibold text-slate-600 mb-1">תמונות (אופציונלי)</label>
                <label className="flex flex-col items-center justify-center border border-dashed border-slate-300 rounded-2xl p-4 cursor-pointer bg-slate-50">
                  <ImageIcon className="w-5 h-5 text-slate-400 mb-1" />
                  <span className="text-xs text-slate-500">העלה תמונה מהמחשב/טלפון</span>
                  <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                </label>
                {formData.images.length > 0 && (
                  <div className="grid grid-cols-4 gap-2 mt-2">
                    {formData.images.map((img, idx) => (
                      <div key={idx} className="relative aspect-square rounded-xl overflow-hidden border">
                        <img src={img} className="w-full h-full object-cover" alt="" />
                        <button type="button" onClick={() => removeImageFromForm(idx)} className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1"><X className="w-3 h-3" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 shrink-0">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100">ביטול</button>
                <button type="submit" disabled={saving} className="px-5 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white disabled:opacity-50">{saving ? 'שומר...' : 'שמור'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Settings Modal (Responsive + Tabbed) */}
      {isAdmin && isAdminModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col my-4 sm:my-8 max-h-[90vh]">
            
            <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center shrink-0">
              <h2 className="text-base sm:text-lg font-bold">הגדרות מנהל מערכת</h2>
              <button onClick={() => setIsAdminModalOpen(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X className="w-5 h-5"/></button>
            </div>

            <div className="flex border-b border-slate-100 shrink-0 bg-slate-50/50">
              <button onClick={() => setActiveAdminTab('users')} className={`flex-1 py-3.5 text-sm font-semibold border-b-2 transition flex items-center justify-center gap-2 ${activeAdminTab === 'users' ? 'border-slate-900 text-slate-900 bg-white' : 'border-transparent text-slate-500'}`}><Users className="w-4 h-4"/> ניהול הרשאות</button>
              <button onClick={() => setActiveAdminTab('email')} className={`flex-1 py-3.5 text-sm font-semibold border-b-2 transition flex items-center justify-center gap-2 ${activeAdminTab === 'email' ? 'border-slate-900 text-slate-900 bg-white' : 'border-transparent text-slate-500'}`}><Mail className="w-4 h-4"/> אימייל אוטומטי</button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 sm:p-6">
              {activeAdminTab === 'users' && (
                <section>
                  <form onSubmit={handleAddStaff} className="flex flex-col gap-3 mb-6 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                    <h3 className="text-sm font-bold text-slate-800 mb-1">הוספת משתמש חדש</h3>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input type="text" placeholder="שם משתמש" required value={newStaffUsername} onChange={(e)=>setNewStaffUsername(e.target.value)} className="flex-1 px-3 py-2 text-sm border rounded-xl bg-white"/>
                      <input type="text" placeholder="סיסמה" required value={newStaffPassword} onChange={(e)=>setNewStaffPassword(e.target.value)} className="flex-1 px-3 py-2 text-sm border rounded-xl bg-white" dir="ltr"/>
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="flex items-center cursor-pointer text-sm gap-2 text-slate-700 font-medium">
                        <input type="checkbox" checked={newStaffCanChangeStatus} onChange={(e)=>setNewStaffCanChangeStatus(e.target.checked)} className="rounded border-slate-300 w-4 h-4 text-slate-900"/>
                        מורשה לשנות סטטוס (אישור הוזמן/התקבל)
                      </label>
                      <button type="submit" disabled={creatingStaff} className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold shrink-0">הוסף</button>
                    </div>
                  </form>
                  
                  <div className="space-y-2">
                    {staffList.map((s) => (
                      <div key={s.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 bg-slate-50 rounded-xl border border-slate-100 gap-3">
                        <div>
                          <span className="font-semibold text-sm mr-2">{s.username}</span>
                          <span className="text-xs text-slate-400 font-mono">({s.password})</span>
                        </div>
                        <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto">
                          <label className="flex items-center cursor-pointer text-xs gap-1.5 font-medium text-slate-600">
                            <input type="checkbox" checked={s.canChangeStatus} onChange={() => handleToggleStaffStatusPermission(s)} className="rounded border-slate-300 w-3.5 h-3.5"/>
                            מורשה סטטוס
                          </label>
                          <label className="flex items-center cursor-pointer text-xs gap-1.5 font-medium text-slate-600">
                            <input type="checkbox" checked={s.active} onChange={() => handleToggleStaffActive(s)} className="rounded border-slate-300 w-3.5 h-3.5"/>
                            פעיל
                          </label>
                          <button onClick={() => handleDeleteStaff(s)} className="text-rose-500 p-1.5 bg-white rounded-lg border border-rose-100 hover:bg-rose-50"><Trash2 className="w-4 h-4"/></button>
                        </div>
                      </div>
                    ))}
                    {staffList.length === 0 && <p className="text-sm text-slate-500 text-center py-4">אין משתמשים מורשים עדיין.</p>}
                  </div>
                </section>
              )}

              {activeAdminTab === 'email' && (
                <section>
                  <div className="bg-amber-50 text-amber-800 text-xs p-3 rounded-xl mb-4 border border-amber-200">
                    <span className="font-bold block mb-1">שים לב:</span>
                    כאן ניתן להגדיר את פרטי ההתחברות לשירות EmailJS לשליחת התראות אוטומטיות למשרד בכל פעם שנוצרת הזמנה חדשה.
                  </div>
                  <form onSubmit={handleSaveAdminSettings} className="space-y-3">
                    <label className="block">
                      <span className="text-xs font-semibold text-slate-600 block mb-1">מייל לקבלת התראות (של המשרד)</span>
                      <input type="email" value={settingsForm.notificationEmail} onChange={(e)=>setSettingsForm({...settingsForm, notificationEmail: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-xl bg-slate-50" dir="ltr"/>
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-slate-600 block mb-1">EmailJS Service ID</span>
                      <input type="text" value={settingsForm.emailjsServiceId} onChange={(e)=>setSettingsForm({...settingsForm, emailjsServiceId: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-xl bg-slate-50" dir="ltr"/>
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-slate-600 block mb-1">EmailJS Template ID</span>
                      <input type="text" value={settingsForm.emailjsTemplateId} onChange={(e)=>setSettingsForm({...settingsForm, emailjsTemplateId: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-xl bg-slate-50" dir="ltr"/>
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-slate-600 block mb-1">EmailJS Public Key</span>
                      <input type="text" value={settingsForm.emailjsPublicKey} onChange={(e)=>setSettingsForm({...settingsForm, emailjsPublicKey: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-xl bg-slate-50" dir="ltr"/>
                    </label>
                    
                    <div className="pt-4 border-t border-slate-100 mt-4">
                      <button type="submit" disabled={savingSettings} className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold w-full sm:w-auto transition">
                        שמור הגדרות אימייל
                      </button>
                    </div>
                  </form>
                </section>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Chat & History Details Modal */}
      {activeDetailsOrderId && activeDetailsOrder && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl overflow-hidden my-4 flex flex-col h-[80vh]">
            <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center shrink-0">
              <h2 className="text-base sm:text-lg font-bold">{activeDetailsOrder.orderType === 'B2B' ? activeDetailsOrder.customerName : 'הזמנת מלאי'} - פרטים</h2>
              <button onClick={() => setActiveDetailsOrderId(null)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X className="w-5 h-5"/></button>
            </div>
            <div className="flex border-b border-slate-100 shrink-0">
              <button onClick={() => setActiveTab('chat')} className={`flex-1 py-3 text-sm font-semibold border-b-2 transition ${activeTab === 'chat' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500'}`}>צ'אט והודעות</button>
              <button onClick={() => setActiveTab('logs')} className={`flex-1 py-3 text-sm font-semibold border-b-2 transition ${activeTab === 'logs' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500'}`}>היסטוריית שינויים</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 bg-slate-50/50">
              {activeTab === 'logs' ? (
                <div className="space-y-3">
                  {[...(activeDetailsOrder.logs || [])].reverse().map((log, i) => (
                    <div key={i} className="bg-white p-3 rounded-xl border border-slate-100 text-sm">
                      <div className="flex justify-between items-center mb-1 text-slate-500 text-xs">
                        <span className="font-semibold text-slate-700">{log.user}</span>
                        <span>{formatDateTime(log.timestamp)}</span>
                      </div>
                      <p className="text-slate-800">{log.action}</p>
                    </div>
                  ))}
                  {(!activeDetailsOrder.logs || activeDetailsOrder.logs.length === 0) && <p className="text-center text-slate-400 text-sm py-8">אין היסטוריית שינויים להזמנה זו.</p>}
                </div>
              ) : (
                <div className="flex flex-col h-full">
                  <div className="flex-1 overflow-y-auto space-y-3 pb-4">
                    {(!activeDetailsOrder.messages || activeDetailsOrder.messages.length === 0) && <p className="text-center text-slate-400 text-sm py-8">אין עדיין הודעות להזמנה זו.</p>}
                    {activeDetailsOrder.messages?.map((msg, i) => (
                      <div key={i} className={`flex flex-col ${msg.user === currentDisplayName ? 'items-end' : 'items-start'}`}>
                        <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${msg.user === currentDisplayName ? 'bg-slate-900 text-white rounded-br-none' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-none'}`}>
                          {msg.text}
                        </div>
                        <span className="text-[10px] text-slate-400 mt-1">{msg.user} • {formatDateTime(msg.timestamp)}</span>
                      </div>
                    ))}
                  </div>
                  <form onSubmit={handleSendMessage} className="flex gap-2 shrink-0 bg-white p-1 rounded-2xl border border-slate-200">
                    <input type="text" placeholder="כתוב הודעה..." value={newMessageText} onChange={(e) => setNewMessageText(e.target.value)} className="flex-1 px-3 py-2 text-sm outline-none bg-transparent" />
                    <button type="submit" disabled={sendingMsg || !newMessageText.trim()} className="p-2 bg-slate-900 text-white rounded-xl disabled:opacity-50"><Send className="w-4 h-4 rtl:-scale-x-100" /></button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Image */}
      {lightboxImage && (
        <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-2 sm:p-4" onClick={() => setLightboxImage(null)}>
          <img src={lightboxImage} alt="Fullscreen View" className="max-w-full max-h-full object-contain rounded-lg" />
          <button className="absolute top-4 right-4 text-white/70 hover:text-white p-2"><X className="w-8 h-8" /></button>
        </div>
      )}
    </div>
  );
}