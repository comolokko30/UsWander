/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  MapPin, 
  Heart, 
  Camera, 
  Plus, 
  Navigation, 
  CheckCircle2, 
  Star, 
  X,
  Image as ImageIcon,
  Loader2,
  Trash2,
  History,
  MessageSquareQuote
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- Firebase Imports ---
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged,
  User
} from 'firebase/auth';
import { 
  initializeFirestore,
  getFirestore, 
  doc, 
  setDoc, 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  deleteDoc,
  serverTimestamp,
  updateDoc,
  getDocFromServer,
  Timestamp
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// --- Utilities ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const handleFirestoreError = (error: unknown, operation: string, path?: string) => {
  const firebaseError = error as { code?: string; message?: string };
  if (firebaseError?.code === 'permission-denied') {
    const errorInfo = {
      error: firebaseError.message || 'Unknown error',
      operationType: operation,
      path: path || null,
      authInfo: {
        userId: auth.currentUser?.uid || 'anonymous',
        email: auth.currentUser?.email || 'no-email',
        emailVerified: auth.currentUser?.emailVerified || false,
        isAnonymous: auth.currentUser?.isAnonymous || false,
        providerInfo: auth.currentUser?.providerData.map(p => ({
          providerId: p.providerId,
          displayName: p.displayName || '',
          email: p.email || ''
        })) || []
      }
    };
    console.error("Firestore Permission Error:", JSON.stringify(errorInfo, null, 2));
    throw new Error(JSON.stringify(errorInfo));
  }
  throw error;
};

// --- Firebase Initialization ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Connectivity fix: Use initializeFirestore with long polling to bypass network blocks
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});

/// --- Types ---
interface Place {
  id: string;
  name: string;
  address: string;
  visited: boolean;
  rating: number;
  note?: string;
  photos: string[];
  visitedAt: Timestamp | null;
  createdAt: Timestamp | null;
}

// --- Components ---

const Button = ({ 
  children, 
  className, 
  variant = 'primary', 
  loading = false,
  ...props 
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'dark', loading?: boolean }) => {
  const variants = {
    primary: 'bg-rose-500 text-white hover:bg-rose-600 shadow-sm active:scale-95',
    secondary: 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 active:scale-95',
    dark: 'bg-slate-900 text-white hover:bg-slate-800 active:scale-95',
    danger: 'bg-red-50 text-red-600 hover:bg-red-100 active:scale-95',
    ghost: 'bg-transparent hover:bg-slate-100 text-slate-500 active:scale-95',
  };

  return (
    <button 
      className={cn(
        'px-4 py-2 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none min-h-[44px]',
        variants[variant],
        className
      )}
      disabled={loading}
      {...props}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : children}
    </button>
  );
};

const Card = ({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('bg-white rounded-2xl p-5 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05)] border border-slate-200/60 transition-all', className)} {...props}>
    {children}
  </div>
);

const StarRating = ({ rating, onChange, readonly = false }: { rating: number, onChange?: (r: number) => void, readonly?: boolean }) => {
  return (
    <div className="flex gap-2">
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => !readonly && onChange?.(s)}
          className={cn(
            "transition-transform active:scale-150 p-1",
            readonly ? "cursor-default" : "cursor-pointer"
          )}
        >
          <Star 
            className={cn(
              "w-5 h-5",
              s <= rating ? "fill-amber-400 text-amber-400" : "text-slate-200"
            )} 
          />
        </button>
      ))}
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [activeTab, setActiveTab] = useState<'plan' | 'memories' | 'timeline' | 'stats'>('plan');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isRatingModalOpen, setIsRatingModalOpen] = useState(false);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);

  // States for new place
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  // States for rating & memory
  const [rating, setRating] = useState(5);
  const [visitNote, setVisitNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
        setConnectionError(null);
      } catch (error) {
        const err = error as any;
        // Check for both code and message for maximum compatibility
        if(err?.code === 'permission-denied' || err?.message?.toLowerCase().includes('permission')) {
          console.log("Database connection established (Handshake OK).");
          setConnectionError(null);
        } else {
          console.error("Veritabanı bağlantısı hatası (Kod:", err?.code, "):", err?.message);
          setConnectionError(err?.message || "Bilinmeyen bağlantı hatası");
        }
      }
    }
    testConnection();
  }, []);

  // Auth Listener & Auto Anonymous Login
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setLoading(false);
      } else {
        setPlaces([]); // Clear places here instead of useEffect
        signInAnonymously(auth).catch(err => {
          console.error("Anon login failed:", err);
          setLoading(false);
        });
      }
    });
    return () => unsubscribe();
  }, []);

  // Data Listener
  useEffect(() => {
    if (!user) return;

    // Shared query for both Murat and Cansu
    const q = query(
      collection(db, 'places'), 
      orderBy('createdAt', 'desc')
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const placesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Place[];
      setPlaces(placesData);
    }, (error) => {
      console.error("Firestore listener error:", error);
      // Handle the "insufficient permissions" error if query doesn't match rules
    });

    return () => unsubscribe();
  }, [user]);

  const addPlace = async () => {
    if (!newName.trim() || !user) return;
    setIsAdding(true);
    try {
      const placeId = crypto.randomUUID();
      await setDoc(doc(db, 'places', placeId), {
        name: newName,
        address: newAddress,
        visited: false,
        rating: 0,
        photos: [],
        visitedAt: null,
        createdAt: serverTimestamp()
      });
      setNewName('');
      setNewAddress('');
      setIsAddModalOpen(false);
    } catch (error) {
      console.error("Failed to add place:", error);
      handleFirestoreError(error, 'create', 'places');
    } finally {
      setIsAdding(false);
    }
  };

  const deletePlace = async (id: string) => {
    // window.confirm is often blocked in iframes, so we perform delete directly
    // and let the real-time listener update the UI.
    try {
      await deleteDoc(doc(db, 'places', id));
    } catch (error) {
      console.error("Failed to delete place:", error);
      handleFirestoreError(error, 'delete', `places/${id}`);
    }
  };

  const startRating = (id: string) => {
    setSelectedPlaceId(id);
    setIsRatingModalOpen(true);
    setRating(5);
    setVisitNote('');
    setPhotos([]);
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file: File) => {
      if (photos.length >= 6) return;
      
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        if (result.length > 500000) {
          alert("Fotoğraf boyutu çok büyük!");
          return;
        }
        setPhotos(prev => [...prev, result]);
      };
      reader.readAsDataURL(file);
    });
  };

  const markAsVisited = async () => {
    if (!selectedPlaceId) return;
    try {
      await updateDoc(doc(db, 'places', selectedPlaceId), {
        visited: true,
        rating,
        note: visitNote,
        photos,
        visitedAt: serverTimestamp(),
      });
      setIsRatingModalOpen(false);
      setSelectedPlaceId(null);
      setActiveTab('timeline');
    } catch (error) {
      console.error("Failed to mark visited:", error);
      handleFirestoreError(error, 'update', `places/${selectedPlaceId}`);
    }
  };

  const openInMaps = (address: string) => {
    if (!address) return;
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, '_blank');
  };

  const filteredPlaces = places.filter(p => activeTab === 'plan' ? !p.visited : p.visited);
  const visitedCount = places.filter(p => p.visited).length;
  const progressPercent = places.length > 0 ? (visitedCount / places.length) * 100 : 0;

  // Timeline view groups places by date
  const timelinePlaces = [...places]
    .filter(p => p.visited && p.visitedAt)
    .sort((a, b) => b.visitedAt.toMillis() - a.visitedAt.toMillis());

  if (loading || connectionError) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 gap-6">
        {!connectionError && (
          <>
            <Loader2 className="w-8 h-8 text-rose-500 animate-spin" />
            <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Cansu & Murat Yükleniyor...</p>
          </>
        )}
        
        {connectionError && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-sm bg-white rounded-3xl p-8 shadow-2xl shadow-rose-100/50 border border-slate-100 flex flex-col items-center text-center"
          >
            <div className="w-16 h-16 bg-rose-50 rounded-2xl flex items-center justify-center mb-6">
              <Navigation className="w-8 h-8 text-rose-500" />
            </div>
            
            <h3 className="text-xl font-bold text-slate-800 mb-3">Bağlantı Hatası</h3>
            <p className="text-slate-500 text-sm leading-relaxed mb-8">
              Kendi Firebase projenize bağlandık ama **Firestore Database** servisi henüz başlatılmamış olabilir.
            </p>

            <div className="w-full space-y-4 mb-10 text-left">
              <div className="flex gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="w-6 h-6 bg-white rounded-lg flex items-center justify-center text-[10px] font-bold text-slate-400 shadow-sm shrink-0">1</div>
                <div className="text-[11px] text-slate-600 leading-tight">
                  <span className="font-bold text-slate-800 block mb-1">Firestore'u Başlat</span>
                  Firebase Console'da <strong>Firestore Database</strong> sekmesine gidip "Create Database" deyin.
                </div>
              </div>

              <div className="flex gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="w-6 h-6 bg-white rounded-lg flex items-center justify-center text-[10px] font-bold text-slate-400 shadow-sm shrink-0">2</div>
                <div className="text-[11px] text-slate-600 leading-tight">
                  <span className="font-bold text-slate-800 block mb-1">Giriş Yönetimi</span>
                  <strong>Authentication</strong> sekmesinden "Anonymous" giriş yöntemini etkinleştirin.
                </div>
              </div>
            </div>

            <button 
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-rose-500 text-white rounded-2xl font-bold shadow-lg shadow-rose-200 hover:bg-rose-600 active:scale-[0.98] transition-all"
            >
              Kurulumu Tamamladım, Dene
            </button>
            <p className="mt-4 text-[10px] text-slate-400">Teknik Detay: {connectionError}</p>
          </motion.div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 font-sans overflow-hidden">
      {/* Sidebar - Desktop Only */}
      <aside className="hidden lg:flex flex-col w-[300px] bg-white border-r border-slate-200 p-8 justify-between shrink-0 shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Heart className="w-5 h-5 text-rose-500 fill-rose-500" />
            <span className="text-xl font-extrabold text-slate-900 tracking-tight">Cansu & Murat</span>
          </div>
          <p className="text-sm text-slate-500 font-medium ml-7">Yol Aşkımız</p>

          <nav className="mt-12 space-y-2">
            <button
              onClick={() => setActiveTab('plan')}
              className={cn(
                "w-full flex items-center gap-3 px-5 py-3.5 rounded-2xl transition-all font-bold text-sm",
                activeTab === 'plan' ? "bg-slate-900 text-white shadow-xl shadow-slate-200" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
              )}
            >
              <MapPin className={cn("w-4 h-4", activeTab === 'plan' ? "text-rose-400" : "")} />
              Gidilecek Yerler
            </button>
            <button
              onClick={() => setActiveTab('timeline')}
              className={cn(
                "w-full flex items-center gap-3 px-5 py-3.5 rounded-2xl transition-all font-bold text-sm",
                activeTab === 'timeline' ? "bg-slate-900 text-white shadow-xl shadow-slate-200" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
              )}
            >
              <History className={cn("w-4 h-4", activeTab === 'timeline' ? "text-rose-400" : "")} />
              Zaman Tüneli
            </button>
            <button
              onClick={() => setActiveTab('memories')}
              className={cn(
                "w-full flex items-center gap-3 px-5 py-3.5 rounded-2xl transition-all font-bold text-sm",
                activeTab === 'memories' ? "bg-slate-900 text-white shadow-xl shadow-slate-200" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
              )}
            >
              <Camera className={cn("w-4 h-4", activeTab === 'memories' ? "text-rose-400" : "")} />
              Fotoğraflar
            </button>
            <button
              onClick={() => setActiveTab('stats')}
              className={cn(
                "w-full flex items-center gap-3 px-5 py-3.5 rounded-2xl transition-all font-bold text-sm",
                activeTab === 'stats' ? "bg-slate-900 text-white shadow-xl shadow-slate-200" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
              )}
            >
              <Heart className={cn("w-4 h-4", activeTab === 'stats' ? "text-rose-400" : "")} />
              Bizim Sayfamız
            </button>
          </nav>
        </div>

        <div className="space-y-6">
          {/* Stats Card */}
          <div className="bg-slate-900 rounded-3xl p-6 text-white shadow-[0_20px_50px_rgba(15,23,42,0.1)]">
            <div className="text-[10px] uppercase font-black text-rose-400 tracking-[0.2em] mb-2">KEŞİF DURUMU</div>
            <div className="text-2xl font-black">{visitedCount} Yer</div>
            <div className="h-2 bg-white/10 rounded-full mt-5 overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                className="h-full bg-rose-500 rounded-full" 
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-3 font-bold opacity-80">% {Math.round(progressPercent)} tamamlandı ✨</p>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden relative">
        {/* Top Bar - Mobile Title */}
        <header className="lg:hidden h-16 bg-white/80 backdrop-blur-md border-b border-slate-200 flex items-center justify-center sticky top-0 z-40 shrink-0">
          <div className="flex items-center gap-2">
            <Heart className="w-5 h-5 text-rose-500 fill-rose-500" />
            <h1 className="text-lg font-black text-slate-900 tracking-tighter">Cansu & Murat</h1>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-8 md:px-10 md:py-12 pb-32 lg:pb-12 custom-scrollbar focus:outline-none">
          <div className="max-w-4xl mx-auto space-y-10">
            {/* Context Heading */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
              <div className="space-y-1">
                <h2 className="text-4xl md:text-5xl font-black text-slate-900 tracking-tighter uppercase">
                  {activeTab === 'plan' ? 'Nereye Gidiyoruz?' : activeTab === 'timeline' ? 'Zaman Tüneli' : activeTab === 'memories' ? 'Fotoğraflarımız' : 'Bizim Yolumuz'}
                </h2>
                <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">
                   {activeTab === 'plan' ? 'Birlikte Yeni Keşifler Zamanı' : activeTab === 'timeline' ? 'Anıların Kronolojik Yolculuğu' : activeTab === 'memories' ? 'Her Kare Bir Mutluluk' : 'İstatistikler ve Durumumuz'}
                </p>
              </div>
              <Button onClick={() => setIsAddModalOpen(true)} className="px-10 py-5 rounded-2xl text-md shadow-2xl shadow-rose-200/50 hidden md:flex">
                <Plus className="w-5 h-5" />
                Yeni Yer Ekle
              </Button>
            </div>

            {/* Content Switcher */}
            <AnimatePresence mode="wait">
              {activeTab === 'plan' && (
                <motion.div
                  key="plan"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="grid grid-cols-1 md:grid-cols-2 gap-5"
                >
                  {filteredPlaces.length === 0 ? (
                    <div className="col-span-full py-20 flex flex-col items-center justify-center text-center space-y-4">
                      <div className="w-20 h-20 bg-white rounded-3xl shadow-sm border border-slate-100 flex items-center justify-center text-slate-200">
                         <MapPin className="w-10 h-10" />
                      </div>
                      <p className="text-slate-400 font-bold max-w-xs text-sm">Haritada seçtiğimiz o yer henüz yok. Hadi bir rota ekleyelim!</p>
                    </div>
                  ) : (
                    filteredPlaces.map((place) => (
                      <Card key={place.id} className="group relative flex flex-col justify-between border-slate-200/50 hover:border-rose-400/30 transition-all">
                        <div className="space-y-4">
                          <div className="flex justify-between items-start gap-4">
                            <h3 className="text-xl font-black text-slate-900 leading-tight group-hover:text-rose-500 transition-colors uppercase tracking-tight">{place.name}</h3>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                deletePlace(place.id);
                              }} 
                              className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-50 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-all shadow-sm border border-slate-100"
                              title="Sil"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          <p className="text-xs text-slate-400 font-bold flex items-center gap-1.5 uppercase tracking-tighter truncate">
                            <MapPin className="w-4 h-4 text-emerald-400" />
                            {place.address}
                          </p>
                        </div>

                        <div className="mt-8 flex gap-3">
                          <Button variant="secondary" className="flex-1 rounded-xl" onClick={() => openInMaps(place.address)}>
                            <Navigation className="w-4 h-4 text-rose-500" />
                            <span className="hidden sm:inline">Navigasyon</span>
                          </Button>
                          <Button variant="dark" className="flex-1 rounded-xl" onClick={() => startRating(place.id)}>
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            <span className="hidden sm:inline">Gittik</span>
                          </Button>
                        </div>
                      </Card>
                    ))
                  )}
                </motion.div>
              )}

              {activeTab === 'timeline' && (
                <motion.div
                  key="timeline"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-12 relative before:absolute before:left-4 md:before:left-1/2 before:top-0 before:bottom-0 before:w-0.5 before:bg-slate-200 before:-translate-x-1/2"
                >
                  {timelinePlaces.length === 0 ? (
                    <div className="py-20 flex flex-col items-center justify-center text-center space-y-4">
                       <div className="w-20 h-20 bg-white rounded-3xl shadow-sm border border-slate-100 flex items-center justify-center text-slate-200">
                          <History className="w-10 h-10" />
                       </div>
                       <p className="text-slate-400 font-bold text-sm">Zaman tüneli anılarınızla dolsun diye sabırsızlanıyoruz!</p>
                    </div>
                  ) : (
                    timelinePlaces.map((place, index) => (
                      <div key={place.id} className={cn(
                        "relative flex flex-col md:flex-row gap-8 items-start md:items-center",
                        index % 2 === 0 ? "md:flex-row" : "md:flex-row-reverse"
                      )}>
                         {/* Dot */}
                         <div className="absolute left-4 md:left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-rose-500 border-4 border-white shadow-lg z-10" />
                         
                         {/* Content Card */}
                         <div className={cn(
                           "flex-1 w-full pl-12 md:pl-0",
                           index % 2 === 0 ? "md:text-right" : "md:text-left"
                         )}>
                            <Card className="hover:shadow-xl transition-shadow border-none bg-white p-6 md:p-8 rounded-[2rem] relative group/card">
                               <div className="flex flex-col gap-2 mb-4">
                                  <div className={cn(
                                    "flex items-center gap-4",
                                    index % 2 === 0 ? "md:flex-row-reverse" : "md:flex-row"
                                  )}>
                                    <span className="text-[10px] font-black text-rose-500 uppercase tracking-widest">
                                      {format(place.visitedAt.toDate(), 'd MMMM yyyy, EEEE', { locale: tr })}
                                    </span>
                                    <button 
                                      onClick={() => deletePlace(place.id)}
                                      className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-50 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-all shadow-sm border border-slate-100 ml-auto md:ml-0"
                                      title="Anıyı Sil"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                  <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tighter">{place.name}</h3>
                               </div>

                               {place.note && (
                                 <div className={cn(
                                   "mb-6 p-4 bg-slate-50 rounded-2xl border-l-4 border-rose-400 text-sm text-slate-600 font-medium italic relative group",
                                   index % 2 === 0 ? "text-right border-l-0 border-r-4 pr-4" : "text-left"
                                 )}>
                                   <MessageSquareQuote className={cn(
                                     "w-4 h-4 absolute text-rose-200",
                                     index % 2 === 0 ? "left-2 -top-2" : "right-2 -top-2"
                                   )} />
                                   "{place.note}"
                                 </div>
                               )}

                               {place.photos && place.photos.length > 0 && (
                                 <div className={cn(
                                   "grid gap-2",
                                   place.photos.length === 1 ? "grid-cols-1" : place.photos.length === 2 ? "grid-cols-2" : "grid-cols-3"
                                 )}>
                                   {place.photos.slice(0, 3).map((img, i) => (
                                     <div key={i} className="aspect-square rounded-2xl overflow-hidden shadow-sm border border-slate-100">
                                       <img src={img} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                     </div>
                                   ))}
                                 </div>
                               )}

                               <div className="mt-6 flex items-center gap-1.5 md:justify-end group-even:md:justify-start">
                                  <StarRating rating={place.rating} readonly />
                               </div>
                            </Card>
                         </div>

                         {/* Spacer for reverse layout alignment */}
                         <div className="hidden md:block flex-1" />
                      </div>
                    ))
                  )}
                </motion.div>
              )}

              {activeTab === 'memories' && (
                <motion.div
                  key="memories"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4"
                >
                  {places.filter(p => p.visited).flatMap(p => p.photos || []).length === 0 ? (
                    <div className="col-span-full py-20 flex flex-col items-center justify-center text-center space-y-4 bg-white/50 rounded-3xl">
                       <ImageIcon className="w-12 h-12 text-slate-200" />
                       <p className="text-slate-400 font-bold text-xs uppercase tracking-widest">Henüz hiç fotoğraf yüklenmemiş.</p>
                    </div>
                  ) : (
                    places.filter(p => p.visited).flatMap(p => (p.photos || []).map((img, i) => ({ img, id: `${p.id}-${i}`, name: p.name }))).map((item) => (
                      <div key={item.id} className="relative group rounded-2xl overflow-hidden break-inside-avoid shadow-sm border border-white">
                        <img src={item.img} alt="" className="w-full h-auto object-cover" referrerPolicy="no-referrer" />
                        <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                           <p className="text-[10px] text-white font-bold uppercase tracking-widest">{item.name}</p>
                        </div>
                      </div>
                    ))
                  )}
                </motion.div>
              )}

              {activeTab === 'stats' && (
                <motion.div
                  key="stats"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="space-y-6"
                >
                  <div className="bg-white p-8 rounded-[3rem] shadow-xl border border-slate-100 flex flex-col items-center text-center space-y-6">
                    <div className="w-24 h-24 bg-rose-50 rounded-full flex items-center justify-center border-4 border-white shadow-inner">
                      <Heart className="w-10 h-10 text-rose-500 fill-rose-500 animate-pulse" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">Neredeyse Her Yerdeyiz!</h3>
                      <p className="text-slate-400 font-medium text-sm">Cansu & Murat'ın keşif serüveni</p>
                    </div>

                    <div className="w-full space-y-8 pt-4">
                       <div className="space-y-3">
                          <div className="flex justify-between items-end px-1">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">TOPLAM KEŞİF</span>
                            <span className="text-2xl font-black text-slate-900">{visitedCount} / {places.length}</span>
                          </div>
                          <div className="h-4 bg-slate-100 rounded-full overflow-hidden p-1 shadow-inner">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${progressPercent}%` }}
                              className="h-full bg-rose-500 rounded-full shadow-lg"
                            />
                          </div>
                          <p className="text-center text-[10px] font-black text-rose-500 uppercase tracking-widest">% {Math.round(progressPercent)} TAMAMLANDI</p>
                       </div>

                       <div className="grid grid-cols-2 gap-4">
                          <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
                             <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">BEKLEYEN</div>
                             <div className="text-3xl font-black text-slate-900">{places.length - visitedCount}</div>
                             <div className="text-[9px] font-bold text-slate-300 mt-1">YENİ MACERA</div>
                          </div>
                          <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
                             <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">ANILAR</div>
                             <div className="text-3xl font-black text-slate-900">{places.filter(p => p.visited).flatMap(p => p.photos || []).length}</div>
                             <div className="text-[9px] font-bold text-slate-300 mt-1">FOTOĞRAF</div>
                          </div>
                       </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>

        {/* Mobile Bottom Navigation */}
        <nav className="lg:hidden fixed bottom-6 left-1/2 -translate-x-1/2 w-[94%] max-w-md bg-slate-900/95 backdrop-blur-2xl rounded-[2.5rem] grid grid-cols-5 items-center h-20 z-50 shadow-2xl border border-white/10 px-1">
           <button 
             onClick={() => setActiveTab('plan')}
             className={cn("flex flex-col items-center justify-center gap-1.5 h-full transition-all rounded-3xl", activeTab === 'plan' ? "text-rose-400" : "text-slate-500")}
           >
             <MapPin className={cn("w-5 h-5", activeTab === 'plan' ? "fill-rose-400/20" : "")} />
             <span className="text-[8px] font-black uppercase tracking-tighter">PLANLAR</span>
           </button>

           <button 
             onClick={() => setActiveTab('timeline')}
             className={cn("flex flex-col items-center justify-center gap-1.5 h-full transition-all rounded-3xl", activeTab === 'timeline' ? "text-rose-400" : "text-slate-500")}
           >
             <History className={cn("w-5 h-5", activeTab === 'timeline' ? "fill-rose-400/20" : "")} />
             <span className="text-[8px] font-black uppercase tracking-tighter">TÜNEL</span>
           </button>

           <div className="flex items-center justify-center">
             <button 
                onClick={() => setIsAddModalOpen(true)}
                className="w-12 h-12 bg-rose-500 text-white rounded-[1.25rem] flex items-center justify-center shadow-lg shadow-rose-500/30 active:scale-95 transition-all border border-white/20"
              >
                <Plus className="w-6 h-6" />
              </button>
           </div>

           <button 
             onClick={() => setActiveTab('memories')}
             className={cn("flex flex-col items-center justify-center gap-1.5 h-full transition-all rounded-3xl", activeTab === 'memories' ? "text-rose-400" : "text-slate-500")}
           >
             <Camera className={cn("w-5 h-5", activeTab === 'memories' ? "fill-rose-400/20" : "")} />
             <span className="text-[8px] font-black uppercase tracking-tighter">GALERİ</span>
           </button>

           <button 
             onClick={() => setActiveTab('stats')}
             className={cn("flex flex-col items-center justify-center gap-1.5 h-full transition-all rounded-3xl", activeTab === 'stats' ? "text-rose-400" : "text-slate-500")}
           >
             <Heart className={cn("w-5 h-5", activeTab === 'stats' ? "fill-rose-400/20" : "")} />
             <span className="text-[8px] font-black uppercase tracking-tighter">DURUM</span>
           </button>
        </nav>
      </div>

      {/* Modals */}
      <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="Nereyi Planlayalım?">
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">MEKAN İSMİ</label>
            <input 
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Gidilecek o yer..."
              className="w-full bg-slate-50 border-2 border-slate-100 focus:border-slate-900 focus:bg-white px-5 py-4 rounded-2xl outline-none transition-all placeholder:text-slate-300 font-bold text-lg"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">ADRES / KONUM</label>
            <input 
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              placeholder="Adres bilgisi buraya..."
              className="w-full bg-slate-50 border-2 border-slate-100 focus:border-slate-900 focus:bg-white px-5 py-4 rounded-2xl outline-none transition-all placeholder:text-slate-300 font-bold text-lg"
            />
          </div>
          <Button onClick={addPlace} variant="dark" className="w-full py-6 text-lg rounded-3xl shadow-xl mt-4" loading={isAdding}>
            Listeye Kaydet ✨
          </Button>
        </div>
      </Modal>

      <Modal isOpen={isRatingModalOpen} onClose={() => setIsRatingModalOpen(false)} title="Anıları Kaydet">
        <div className="space-y-8">
          <div className="bg-slate-50 p-6 sm:p-8 rounded-[2.5rem] border border-slate-100 flex flex-col items-center gap-4">
             <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">BU GEZİYE PUANINIZ</p>
             <StarRating rating={rating} onChange={setRating} />
             <div className="text-3xl font-black text-slate-900 tracking-tighter">{rating}.0 / 5.0</div>
          </div>

          <div className="space-y-3">
             <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">BU GÜNDEN BİR NOT BIRAK</label>
             <textarea 
               value={visitNote}
               onChange={(e) => setVisitNote(e.target.value)}
               placeholder="Neler yaptık? Neyi çok sevdik? Cansu ne dedi?..."
               rows={3}
               className="w-full bg-slate-50 border-2 border-slate-100 focus:border-slate-900 focus:bg-white px-5 py-4 rounded-2xl outline-none transition-all placeholder:text-slate-300 font-bold text-sm resize-none"
             />
          </div>

          <div className="space-y-4">
             <div className="flex items-center justify-between px-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">FOTOĞRAFLAR</label>
                <div className="text-[10px] font-black text-rose-500 uppercase">{photos.length} / 6</div>
             </div>
             
             <input type="file" multiple accept="image/*" className="hidden" ref={fileInputRef} onChange={handlePhotoUpload} />

             <div className="grid grid-cols-4 gap-2">
               {photos.map((p, i) => (
                 <div key={i} className="aspect-square rounded-xl overflow-hidden relative group">
                    <img src={p} alt="" className="w-full h-full object-cover" />
                    <button onClick={() => setPhotos(photos.filter((_, idx) => idx !== i))} className="absolute inset-0 bg-red-600/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <X className="w-5 h-5 text-white" />
                    </button>
                 </div>
               ))}
               {photos.length < 6 && (
                 <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="aspect-square rounded-xl border-dashed border-2 border-slate-200 flex items-center justify-center text-slate-300 hover:border-slate-400 hover:text-slate-400 transition-all"
                 >
                   <Plus className="w-6 h-6" />
                 </button>
               )}
             </div>
          </div>

          <Button onClick={markAsVisited} variant="dark" className="w-full py-6 text-lg rounded-3xl shadow-xl">Anıları Tünele Ekle ❤️</Button>
        </div>
      </Modal>
    </div>
  );
}

const Modal = ({ isOpen, onClose, title, children }: { isOpen: boolean, onClose: () => void, title: string, children: React.ReactNode }) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-6 overflow-hidden">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[5px]"
          />
          <motion.div
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 350 }}
            className="relative w-full max-w-xl bg-white rounded-t-[3rem] sm:rounded-[3rem] p-8 sm:p-12 shadow-2xl overflow-y-auto max-h-[90vh] custom-scrollbar focus:outline-none"
          >
            <div className="flex justify-between items-center mb-10">
              <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">{title}</h2>
              <button onClick={onClose} className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:text-slate-900 transition-all">
                <X className="w-6 h-6" />
              </button>
            </div>
            {children}
            <div className="h-10 sm:hidden" />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
