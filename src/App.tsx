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
  PlusCircle,
  Search,
  Trash2,
  Edit3,
  Image as ImageIcon,
  X,
  CheckCircle,
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
  Mail,
  Hash,
  Layers,
  Building2,
  UserPlus,
  Download,
  Upload,
  KeyRound,
  ShoppingCart,
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
  // Background Firebase connection
  const [fbUser, setFbUser] = useState<FirebaseUser | null>(null);
  const [connecting, setConnecting] = useState(true);

  // Direct Username + Password Auth State
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

  // Data State
  const [orders, setOrders] = useState<Order[]>([]);
  const [staffList, setStaffList] = useState<StaffRecord[]>([]);
  const [settings, setSettings] = useState<EmailSettings>({
    notificationEmail: DEFAULT_NOTIFICATION_EMAIL,
    emailjsServiceId: '',
    emailjsTemplateId: '',
    emailjsPublicKey: '',
    adminPassword: DEFAULT_ADMIN_PASSWORD,
  });

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('הכל');
  const [typeFilter, setTypeFilter] = useState<string>('הכל');

  // Order Add/Edit Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [saving, setSaving] = useState(false);

  // Admin Panel Modal
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
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

  // Silent background connection to Firebase
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

  // Load Firestore collections once background connection is ready
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

  // Auto-logout if staff user was deactivated or removed
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

    // 1. Check Admin Login
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

    // 2. Check Authorized Staff List
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

  // --- Background Office Email Sender via EmailJS REST API ---
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

    if (!notificationEmail || !emailjsServiceId || !emailjsTemplateId || !emailjsPublicKey) {
      console.info('EmailJS background keys are not configured yet in Admin Settings.');
      return;
    }

    const subject =
      data.orderType === 'B2B'
        ? `הזמנת יבוא חדשה (B2B) - ${data.customerName} | הזמנה #${data.orderNumber}`
        : `הזמנת יבוא חדשה למלאי - ${data.modelName}`;

    const messageDetails = [
      `נוספה הזמנת יבוא חדשה למערכת קרמיסו על ידי ${currentDisplayName}:`,
      `סוג הזמנה: ${data.orderType}`,
      ...(data.orderType === 'B2B'
        ? [`שם לקוח: ${data.customerName}`, `מספר הזמנה: ${data.orderNumber}`]
        : []),
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
            order_type: data.orderType,
            customer_name: data.customerName || 'מלאי',
            order_number: data.orderNumber || '-',
            model_name: data.modelName,
            quantity: data.quantity || '-',
            supplier: data.supplier || '-',
            ordered_status: data.isOrdered ? 'הוזמן' : 'לא הוזמן',
            eta: data.eta || '-',
            notes: data.notes || '-',
            created_by: currentDisplayName,
            message: messageDetails,
          },
        }),
      });
    } catch (err) {
      console.error('Background Office email failed:', err);
    }
  };

  // --- Admin Authorized Staff Management (Admin Only) ---
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
        createdAt: Date.now(),
      });
      setNewStaffUsername('');
      setNewStaffPassword('');
    } catch {
      alert('שגיאה בהוספת המשתמש לרשימת המורשים');
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
      alert('שגיאה בעדכון פרטי המשתמש');
    }
  };

  const handleToggleStaffActive = async (staff: StaffRecord) => {
    if (!isAdmin) return;
    try {
      await updateDoc(doc(db, ...STAFF_PATH, staff.id), {
        active: !staff.active,
      });
    } catch {
      alert('שגיאה בשינוי סטטוס המשתמש');
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
    if (Boolean(oldOrder.isOrdered) !== Boolean(newData.isOrdered))
      changes.push(`סטטוס הזמנה (${oldOrder.isOrdered ? 'הוזמן' : 'לא הוזמן'} ← ${newData.isOrdered ? 'הוזמן' : 'לא הוזמן'})`);
    if (oldOrder.eta !== newData.eta)
      changes.push(`צפי הגעה (${oldOrder.eta || 'ללא'} ← ${newData.eta || 'ללא'})`);
    if (oldOrder.notes !== newData.notes) changes.push(`הערות`);
    if ((oldOrder.images?.length || 0) !== newData.images.length)
      changes.push(`תמונות (${oldOrder.images?.length || 0} ← ${newData.images.length})`);

    return changes.length > 0 ? `ערך: ${changes.join(', ')}` : 'שמר עריכה ללא שינוי שדות';
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

        // Send Office email silently in the background without opening mail client
        sendBackgroundOfficeEmail(cleanedPayload);
      }
      setIsModalOpen(false);
    } catch (err) {
      console.error('Save error:', err);
      alert('שגיאה בשמירה לענן. ודא שהפעלת Anonymous Auth ב-Firebase.');
    } finally {
      setSaving(false);
    }
  };

  // Quick checkbox toggle for "הוזמן" directly on card
  const handleToggleOrderedQuick = async (order: Order) => {
    const nextVal = !order.isOrdered;
    try {
      const logEntry: LogEntry = {
        user: currentDisplayName,
        action: nextVal ? 'סימן V: הוזמן מהספק' : 'ביטל סימון הוזמן',
        timestamp: Date.now(),
      };
      const docRef = doc(db, ...ORDERS_PATH, order.id);
      await updateDoc(docRef, {
        isOrdered: nextVal,
        logs: arrayUnion(logEntry),
      });
    } catch {
      alert('שגיאה בעדכון סטטוס הזמנה');
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

  // --- Connecting Screen ---
  if (connecting) {
    return (
      <div dir="rtl" className="min-h-screen bg-stone-900 flex items-center justify-center text-white">
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl bg-amber-500 text-stone-950 font-bold text-2xl flex items-center justify-center mx-auto mb-3 animate-pulse">
            ק
          </div>
          <p className="text-sm text-stone-300">מתחבר למערכת קרמיסו...</p>
        </div>
      </div>
    );
  }

  // --- Direct Username & Password Login Screen ---
  if (!loggedInUser) {
    return (
      <div dir="rtl" className="min-h-screen bg-stone-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl max-w-md w-full p-8 shadow-2xl">
          <div className="text-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-amber-500 flex items-center justify-center text-stone-950 font-bold text-3xl mx-auto shadow-md mb-4">
              ק
            </div>
            <h1 className="text-2xl font-bold text-stone-900">קרמיסו - ניהול הזמנות יבוא</h1>
            <p className="text-stone-500 text-sm mt-1">הזן שם משתמש וסיסמה לכניסה למערכת</p>
          </div>

          {loginError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-3 rounded-xl mb-4 text-center">
              {loginError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1.5">
                שם משתמש
              </label>
              <div className="relative">
                <User className="w-5 h-5 text-stone-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  autoFocus
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  placeholder="הזן שם משתמש"
                  className="w-full pr-11 pl-4 py-3 border border-stone-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none text-stone-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1.5">סיסמה</label>
              <div className="relative">
                <KeyRound className="w-5 h-5 text-stone-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  dir="ltr"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pr-11 pl-4 py-3 border border-stone-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none text-stone-900 text-left"
                />
              </div>
            </div>

            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded border-stone-300 text-amber-500 focus:ring-amber-500"
              />
              <span className="text-sm text-stone-700">זכור אותי במכשיר זה</span>
            </label>

            <button
              type="submit"
              className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold rounded-xl shadow transition cursor-pointer"
            >
              כניסה למערכת
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
                  מחובר: {currentDisplayName}
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
            {/* Admin Only: Authorized Users List & Office Email Settings */}
            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => setIsAdminModalOpen(true)}
                  className="flex items-center gap-1.5 bg-stone-800 hover:bg-stone-700 text-amber-300 text-xs font-semibold px-3 py-2.5 rounded-xl border border-stone-700 transition cursor-pointer"
                >
                  <Users className="w-4 h-4" />
                  <span>רשימת מורשים והגדרות</span>
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
            {['הכל', 'לא הוזמן', 'הוזמן', 'התקבל'].map((status) => (
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
              const msgCount = order.messages?.length || 0;
              const logCount = order.logs?.length || 0;

              return (
                <div
                  key={order.id}
                  className="bg-white rounded-2xl border border-stone-200 shadow-sm hover:shadow-md transition flex flex-col justify-between overflow-hidden"
                >
                  <div>
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

                          {order.isReceived ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border bg-emerald-50 border-emerald-200 text-emerald-700">
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                              התקבל וסופק
                            </span>
                          ) : order.isOrdered ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border bg-blue-50 border-blue-200 text-blue-700">
                              <ShoppingCart className="w-3.5 h-3.5 text-blue-600" />
                              הוזמן
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border bg-amber-50 border-amber-200 text-amber-700">
                              <Clock className="w-3.5 h-3.5 text-amber-600" />
                              לא הוזמן
                            </span>
                          )}
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

                      {/* Quick Ordered Checkbox on Card */}
                      {!order.isReceived && (
                        <div className="pt-1">
                          <label className="inline-flex items-center gap-2 bg-stone-50 hover:bg-stone-100 border border-stone-200 px-3 py-2 rounded-xl cursor-pointer select-none w-full">
                            <input
                              type="checkbox"
                              checked={Boolean(order.isOrdered)}
                              onChange={() => handleToggleOrderedQuick(order)}
                              className="w-4 h-4 rounded border-stone-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-xs font-bold text-stone-800">
                              הוזמן מהספק
                            </span>
                          </label>
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

                    {isAdmin && !order.isReceived && (
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

              {/* Checkbox for Ordered Status (Default: unchecked / false) */}
              <div className="bg-stone-50 border border-stone-200 rounded-xl p-3">
                <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={formData.isOrdered}
                    onChange={(e) => setFormData({ ...formData, isOrdered: e.target.checked })}
                    className="w-5 h-5 rounded border-stone-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-bold text-stone-800">
                    הוזמן מהספק (ברירת מחדל: לא הוזמן)
                  </span>
                </label>
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
                  {saving ? 'שומר...' : editingOrder ? 'שמור שינויים' : 'צור הזמנה'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADMIN ONLY MODAL: Authorized Staff List & Background Office Email Settings */}
      {isAdmin && isAdminModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden my-8">
            <div className="bg-stone-900 text-white px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-amber-400" />
                <h2 className="text-lg font-bold">רשימת מורשים והגדרות מנהל</h2>
              </div>
              <button
                onClick={() => setIsAdminModalOpen(false)}
                className="text-stone-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6 max-h-[82vh] overflow-y-auto">
              {/* Background Office Email & Admin Password Settings */}
              <form
                onSubmit={handleSaveAdminSettings}
                className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4 space-y-3"
              >
                <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
                  <Mail className="w-4 h-4 text-amber-600" />
                  שליחת אימייל אוטומטית ברקע דרך Office 365 (EmailJS) וסיסמת מנהל
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                      אימייל יעד לקבלת התראות
                    </label>
                    <input
                      type="email"
                      required
                      dir="ltr"
                      value={settingsForm.notificationEmail}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, notificationEmail: e.target.value })
                      }
                      placeholder="izak@ceramiso.co.il"
                      className="w-full px-3 py-2 bg-white border border-amber-300 rounded-xl text-xs text-left focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                      סיסמת מנהל ({DEFAULT_ADMIN_USERNAME})
                    </label>
                    <input
                      type="text"
                      required
                      dir="ltr"
                      value={settingsForm.adminPassword || ''}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, adminPassword: e.target.value })
                      }
                      className="w-full px-3 py-2 bg-white border border-amber-300 rounded-xl text-xs text-left focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                      EmailJS Service ID (Office)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={settingsForm.emailjsServiceId}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, emailjsServiceId: e.target.value })
                      }
                      placeholder="service_xxxxxxx"
                      className="w-full px-3 py-2 bg-white border border-stone-300 rounded-xl text-xs text-left"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                      EmailJS Template ID
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={settingsForm.emailjsTemplateId}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, emailjsTemplateId: e.target.value })
                      }
                      placeholder="template_xxxxxxx"
                      className="w-full px-3 py-2 bg-white border border-stone-300 rounded-xl text-xs text-left"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                      EmailJS Public Key
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={settingsForm.emailjsPublicKey}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, emailjsPublicKey: e.target.value })
                      }
                      placeholder="xxxxxxxxxxxxxxx"
                      className="w-full px-3 py-2 bg-white border border-stone-300 rounded-xl text-xs text-left"
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-bold rounded-xl transition cursor-pointer"
                  >
                    {savingSettings ? 'שומר...' : 'שמור הגדרות'}
                  </button>
                </div>
              </form>

              {/* Add Authorized Staff Member */}
              <div className="border border-stone-200 rounded-2xl p-4">
                <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2 mb-3">
                  <UserPlus className="w-4 h-4 text-emerald-600" />
                  הוספת משתמש מורשה (שם משתמש + סיסמה)
                </h3>
                <form onSubmit={handleAddStaff} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <input
                    type="text"
                    required
                    value={newStaffUsername}
                    onChange={(e) => setNewStaffUsername(e.target.value)}
                    placeholder="שם משתמש (לדוגמה: דני)"
                    className="px-3 py-2 border border-stone-300 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    required
                    dir="ltr"
                    value={newStaffPassword}
                    onChange={(e) => setNewStaffPassword(e.target.value)}
                    placeholder="סיסמה לעובד"
                    className="px-3 py-2 border border-stone-300 rounded-xl text-sm text-left focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={creatingStaff}
                    className="py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-xl shadow-xs transition disabled:opacity-50 cursor-pointer"
                  >
                    {creatingStaff ? 'מוסיף...' : 'הוסף לרשימה'}
                  </button>
                </form>
              </div>

              {/* Authorized Staff List */}
              <div>
                <h3 className="text-sm font-bold text-stone-900 mb-2.5">
                  רשימת מורשים פעילה ({staffList.length})
                </h3>
                {staffList.length === 0 ? (
                  <p className="text-xs text-stone-500 bg-stone-50 p-4 rounded-xl text-center">
                    טרם הוגדרו עובדים ברשימת המורשים. הוסף למעלה שם משתמש וסיסמה לכל עובד.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {staffList.map((st) => (
                      <div
                        key={st.id}
                        className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2 ${
                          st.active
                            ? 'bg-white border-stone-200'
                            : 'bg-red-50/50 border-red-200 opacity-75'
                        }`}
                      >
                        {editingStaffId === st.id ? (
                          <div className="flex flex-wrap items-center gap-2 flex-1">
                            <input
                              type="text"
                              value={editStaffUsername}
                              onChange={(e) => setEditStaffUsername(e.target.value)}
                              className="px-2.5 py-1 border border-stone-300 rounded-lg text-xs"
                              placeholder="שם משתמש"
                            />
                            <input
                              type="text"
                              dir="ltr"
                              value={editStaffPassword}
                              onChange={(e) => setEditStaffPassword(e.target.value)}
                              className="px-2.5 py-1 border border-stone-300 rounded-lg text-xs text-left"
                              placeholder="סיסמה"
                            />
                            <button
                              onClick={() => handleSaveStaffEdit(st.id)}
                              className="px-2.5 py-1 bg-emerald-600 text-white text-xs font-bold rounded-lg cursor-pointer"
                            >
                              שמור
                            </button>
                            <button
                              onClick={() => setEditingStaffId(null)}
                              className="px-2.5 py-1 bg-stone-200 text-xs rounded-lg cursor-pointer"
                            >
                              ביטול
                            </button>
                          </div>
                        ) : (
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-stone-900">{st.username}</span>
                              {!st.active && (
                                <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold">
                                  מושבת
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-stone-500">
                              סיסמה: <span dir="ltr" className="font-mono">{st.password}</span>
                            </p>
                          </div>
                        )}

                        {editingStaffId !== st.id && (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingStaffId(st.id);
                                setEditStaffUsername(st.username);
                                setEditStaffPassword(st.password);
                              }}
                              title="ערוך שם או סיסמה"
                              className="p-1.5 text-stone-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg cursor-pointer"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleStaffActive(st)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                                st.active
                                  ? 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                                  : 'bg-emerald-100 text-emerald-800'
                              }`}
                            >
                              {st.active ? 'השבת' : 'הפעל'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteStaff(st)}
                              title="מחק מרשימת המורשים"
                              className="p-1.5 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
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