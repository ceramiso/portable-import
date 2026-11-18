import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
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
  Phone,
  Calendar,
  FileText,
  ZoomIn,
  Check,
  User,
  LogOut,
  History,
  MessageSquare,
  Send,
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
const appId = "ceramic-orders";

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

interface Order {
  id: string;
  customerName: string;
  phone: string;
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

// Compress image to Base64 so multiple photos fit smoothly in Firestore
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
  // User Name Login State (persisted in localStorage)
  const [currentUser, setCurrentUser] = useState<string>(() => {
    return localStorage.getItem('ceramic_user_name') || '';
  });
  const [nameInput, setNameInput] = useState('');

  const [userReady, setUserReady] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('הכל');

  // Add/Edit Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [saving, setSaving] = useState(false);

  // Activity Log & Chat Drawer/Modal State
  const [activeDetailsOrderId, setActiveDetailsOrderId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'chat' | 'logs'>('chat');
  const [newMessageText, setNewMessageText] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);

  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    customerName: '',
    phone: '',
    modelName: '',
    quantity: '',
    supplier: '',
    status: 'הוזמן מספק' as Order['status'],
    eta: '',
    notes: '',
    images: [] as string[],
  });

  useEffect(() => {
    signInAnonymously(auth).catch((err) => console.error('Auth error:', err));
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (user) setUserReady(true);
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!userReady) return;
    const ordersRef = collection(db, 'artifacts', appId, 'public', 'data', 'orders');
    const q = query(ordersRef, orderBy('createdAt', 'desc'));

    const unsubOrders = onSnapshot(
      q,
      (snapshot) => {
        const list: Order[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            customerName: data.customerName || '',
            phone: data.phone || '',
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
      },
      (error) => {
        console.error('Firestore read error:', error);
      }
    );

    return () => unsubOrders();
  }, [userReady]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    localStorage.setItem('ceramic_user_name', trimmed);
    setCurrentUser(trimmed);
  };

  const handleSwitchUser = () => {
    localStorage.removeItem('ceramic_user_name');
    setNameInput(currentUser);
    setCurrentUser('');
  };

  const openNewModal = () => {
    setEditingOrder(null);
    setFormData({
      customerName: '',
      phone: '',
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
      customerName: order.customerName,
      phone: order.phone,
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
    } catch (err) {
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
    if (oldOrder.customerName !== newData.customerName)
      changes.push(`שם לקוח (${oldOrder.customerName} ← ${newData.customerName})`);
    if (oldOrder.phone !== newData.phone)
      changes.push(`טלפון`);
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
    if (oldOrder.notes !== newData.notes)
      changes.push(`הערות`);
    if ((oldOrder.images?.length || 0) !== newData.images.length)
      changes.push(`תמונות (${oldOrder.images?.length || 0} ← ${newData.images.length})`);

    return changes.length > 0 ? `ערך: ${changes.join(', ')}` : 'שמר עריכה ללא שינוי שדות';
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.customerName.trim() || !formData.modelName.trim()) {
      alert('נא למלא לפחות שם לקוח ודגם קרמיקה');
      return;
    }

    setSaving(true);
    try {
      const ordersRef = collection(db, 'artifacts', appId, 'public', 'data', 'orders');
      if (editingOrder) {
        const actionText = describeChanges(editingOrder, formData);
        const logEntry: LogEntry = {
          user: currentUser,
          action: actionText,
          timestamp: Date.now(),
        };
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'orders', editingOrder.id);
        await updateDoc(docRef, {
          ...formData,
          logs: arrayUnion(logEntry),
        });
      } else {
        const initialLog: LogEntry = {
          user: currentUser,
          action: 'יצר את ההזמנה',
          timestamp: Date.now(),
        };
        await addDoc(ordersRef, {
          ...formData,
          createdBy: currentUser,
          createdAt: Date.now(),
          logs: [initialLog],
          messages: [],
        });
      }
      setIsModalOpen(false);
    } catch (err) {
      console.error('Save error:', err);
      alert('שגיאה בשמירה. ייתכן שהתמונות כבדות מדי, נסה להסיר תמונה אחת ולשמור שוב.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmReceived = async (order: Order) => {
    const confirmed = window.confirm('האם אתה בטוח שאתה רוצה לאשר');
    if (!confirmed) return;

    try {
      const logEntry: LogEntry = {
        user: currentUser,
        action: 'אישר קבלה ומסירה ללקוח ("התקבל")',
        timestamp: Date.now(),
      };
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'orders', order.id);
      await updateDoc(docRef, {
        status: 'נמסר ללקוח',
        logs: arrayUnion(logEntry),
      });
    } catch (err) {
      console.error('Status update error:', err);
      alert('שגיאה בעדכון הסטטוס');
    }
  };

  const handleDelete = async (order: Order) => {
    const confirmed = window.confirm(
      `האם למחוק לצמיתות את ההזמנה של "${order.customerName}" (${order.modelName})?`
    );
    if (!confirmed) return;

    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'orders', order.id);
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
        user: currentUser,
        text: newMessageText.trim(),
        timestamp: Date.now(),
      };
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'orders', activeDetailsOrderId);
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

  // --- Name Login Screen (No Password) ---
  if (!currentUser) {
    return (
      <div dir="rtl" className="min-h-screen bg-stone-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl max-w-md w-full p-8 shadow-2xl text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-500 flex items-center justify-center text-stone-950 font-bold text-3xl mx-auto shadow-md mb-4">
            ק
          </div>
          <h1 className="text-2xl font-bold text-stone-900">ניהול הזמנות יבוא קרמיקה</h1>
          <p className="text-stone-500 text-sm mt-1 mb-6">
            הזן את שמך כדי להיכנס למערכת ולתעד פעולות והתכתבויות
          </p>

          <form onSubmit={handleLogin} className="space-y-4 text-right">
            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1.5">
                שם העובד / משתמש
              </label>
              <div className="relative">
                <User className="w-5 h-5 text-stone-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  autoFocus
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="לדוגמה: מאיר, דני, שירות לקוחות..."
                  className="w-full pr-11 pl-4 py-3 border border-stone-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none text-stone-900"
                />
              </div>
            </div>

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
      order.modelName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.supplier.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.phone.includes(searchTerm);
    const matchesStatus = statusFilter === 'הכל' || order.status === statusFilter;
    return matchesSearch && matchesStatus;
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
              <h1 className="text-lg sm:text-xl font-bold tracking-tight">ניהול הזמנות יבוא קרמיקה</h1>
              <div className="flex items-center gap-2 text-xs text-stone-400">
                <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
                  <User className="w-3.5 h-3.5" />
                  מחובר כ: {currentUser}
                </span>
                <span>•</span>
                <button
                  onClick={handleSwitchUser}
                  className="inline-flex items-center gap-1 hover:text-white underline cursor-pointer"
                >
                  <LogOut className="w-3 h-3" />
                  החלף שם
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={openNewModal}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold px-4 py-2.5 rounded-xl shadow transition cursor-pointer"
          >
            <PlusCircle className="w-5 h-5" />
            <span>הזמנה חדשה</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 mt-6">
        {/* Search & Filter Bar */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-stone-200 flex flex-col md:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="w-5 h-5 text-stone-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="חיפוש לפי שם לקוח, דגם, טלפון או ספק..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pr-10 pl-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 md:pb-0">
            {['הכל', ...STATUS_OPTIONS].map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3.5 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition cursor-pointer ${
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
            <p className="text-stone-500 text-sm mt-1">לחץ על "הזמנה חדשה" כדי להוסיף הזמנה ראשונה למערכת</p>
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
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${style.bg} ${style.text}`}
                        >
                          {style.icon}
                          {order.status}
                        </span>
                        <h3 className="text-lg font-bold text-stone-900 mt-2">{order.customerName}</h3>
                        {order.phone && (
                          <a
                            href={`tel:${order.phone}`}
                            className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-amber-600 mt-0.5"
                          >
                            <Phone className="w-3.5 h-3.5" />
                            {order.phone}
                          </a>
                        )}
                      </div>

                      {/* Edit & Delete Buttons */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEditModal(order)}
                          title="ערוך הזמנה"
                          className="p-2 text-stone-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition cursor-pointer"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(order)}
                          title="מחק הזמנה"
                          className="p-2 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
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

                    {/* Quick Confirm "התקבל" Button */}
                    {order.status !== 'נמסר ללקוח' && (
                      <div className="px-4 pb-4">
                        <button
                          type="button"
                          onClick={() => handleConfirmReceived(order)}
                          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm rounded-xl shadow-xs transition cursor-pointer"
                        >
                          <Check className="w-4 h-4" />
                          <span>התקבל</span>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-stone-600 mb-1">שם לקוח *</label>
                  <input
                    type="text"
                    required
                    value={formData.customerName}
                    onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    placeholder="ישראל ישראלי"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-600 mb-1">טלפון</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    placeholder="050-0000000"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-stone-600 mb-1">דגם / מק״ט קרמיקה *</label>
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
                    {STATUS_OPTIONS.map((st) => (
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
                      <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-stone-200">
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

      {/* Chat & Activity Logs Modal */}
      {activeDetailsOrder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            {/* Modal Header */}
            <div className="bg-stone-900 text-white px-5 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold">{activeDetailsOrder.customerName}</h2>
                <p className="text-xs text-stone-400">{activeDetailsOrder.modelName}</p>
              </div>
              <button
                onClick={() => setActiveDetailsOrderId(null)}
                className="text-stone-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
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

            {/* Tab Content */}
            {activeTab === 'chat' ? (
              <>
                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-stone-50 min-h-[250px]">
                  {!activeDetailsOrder.messages || activeDetailsOrder.messages.length === 0 ? (
                    <div className="text-center text-stone-400 text-sm py-10">
                      אין עדיין הודעות בהזמנה זו. כתוב הודעה ראשונה למטה.
                    </div>
                  ) : (
                    activeDetailsOrder.messages.map((msg, idx) => {
                      const isMe = msg.user === currentUser;
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

                {/* Chat Input */}
                <form
                  onSubmit={handleSendMessage}
                  className="p-3 bg-white border-t border-stone-200 flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={newMessageText}
                    onChange={(e) => setNewMessageText(e.target.value)}
                    placeholder={`כתוב הודעה בשם ${currentUser}...`}
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