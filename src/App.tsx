import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  subscribeToArizalar,
  subscribeToConfig,
  fetchPlantSettings,
  fetchAllArizalarDirect
} from './firebase';
import { Ariza, AppConfig, PlantSettings } from './types';
import {
  parseFirestoreDate,
  formatTimeOnly,
  getEffectiveProductionDate,
  isCreatedToday
} from './utils/date';
import { soundFx } from './utils/audio';
import { TvHeader } from './components/TvHeader';
import { ArizaRow } from './components/ArizaRow';
import { ArizaDetailModal } from './components/ArizaDetailModal';
import { getJobTypeConfig } from './utils/jobColors';
import {
  X,
  Inbox,
  Archive,
  CheckCircle2,
  Layers
} from 'lucide-react';

export default function App() {
  const [arizalar, setArizalar] = useState<Ariza[]>([]);
  const [config, setConfig] = useState<AppConfig>({
    operators: [],
    stoppageReasons: [],
    faultReasons: [],
  });
  const [plantSettings, setPlantSettings] = useState<PlantSettings>({
    machines: [],
    operators: [],
    shifts: [],
  });
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [lastSyncTime, setLastSyncTime] = useState<string>('');
  const [selectedAriza, setSelectedAriza] = useState<Ariza | null>(null);

  // Anlık yeni arıza alarm bannerı
  const [newArrivalAlert, setNewArrivalAlert] = useState<Ariza | null>(null);

  const [autoScroll, setAutoScroll] = useState(false);

  // Bu oturumda anlık olarak canlı düşen arızaların kimlikleri
  const [sessionNewArrivalIds, setSessionNewArrivalIds] = useState<Set<string>>(new Set());

  const prevCountRef = useRef<number>(0);
  const prevSigRef = useRef<string>('');
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 1. Firestore canlı dinleyicisi (Real-time snapshot)
  useEffect(() => {
    const markSync = () => {
      setLastSyncTime(
        new Date().toLocaleTimeString('tr-TR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    };

    const unsubArizalar = subscribeToArizalar(
      (data, newlyAddedItems = []) => {
        setIsOnline(true);
        markSync();

        // Eğer anlık yeni bir veya daha fazla arıza eklendiyse
        if (newlyAddedItems.length > 0) {
          const newest = newlyAddedItems[newlyAddedItems.length - 1];
          setNewArrivalAlert(newest);
          soundFx.playUrgentAlarm();

          setSessionNewArrivalIds((prev) => {
            const next = new Set(prev);
            newlyAddedItems.forEach((it) => next.add(it.id));
            return next;
          });

          // En yeni kayıt en üste geldiği için otomatik olarak ekranı en başa sar
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
          }
        } else if (prevCountRef.current > 0 && data.length > prevCountRef.current) {
          soundFx.playUrgentAlarm();
        }

        prevCountRef.current = data.length;
        setArizalar(data);
      },
      () => {
        setIsOnline(false);
      }
    );

    const unsubConfig = subscribeToConfig((cfg) => {
      setConfig(cfg);
    });

    fetchPlantSettings().then((ps) => {
      setPlantSettings(ps);
    });

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      unsubArizalar();
      unsubConfig();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // 2. TV Otomatik Kaydırma Mekanizması
  useEffect(() => {
    if (!autoScroll) return;
    const interval = setInterval(() => {
      if (!scrollContainerRef.current) return;
      const el = scrollContainerRef.current;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 15;
      if (atBottom) {
        el.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        el.scrollBy({ top: 280, behavior: 'smooth' });
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [autoScroll]);

  // Manuel Yenileme
  const handleManualRefresh = async () => {
    try {
      const freshData = await fetchAllArizalarDirect();
      setArizalar(freshData);
      setLastSyncTime(
        new Date().toLocaleTimeString('tr-TR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
      soundFx.playChime();
    } catch (err) {
      console.error(err);
    }
  };

  // 3. Sıralama Fonksiyonu: HER YENİ GELEN KESİNLİKLE EN ÜSTE GELECEK
  const getSortTimestamp = (a: Ariza): number => {
    // Canlı oturumda yeni düşen bir kayıtsa en üstte tut
    if (sessionNewArrivalIds.has(a.id)) {
      return Number.MAX_SAFE_INTEGER;
    }
    const d = parseFirestoreDate(a.createdAt);
    if (!d || isNaN(d.getTime())) {
      // Henüz server timestamp yazılmamış yeni kayıtları en üstte tutmak için şu anki zamanı ver
      return Date.now();
    }
    return d.getTime();
  };

  // 4. Görünüm Modu: Tümü (Aktif + Eski ayrı), Sadece Aktif, Sadece Eski
  const [viewMode, setViewMode] = useState<'tumu' | 'aktif' | 'eski'>('tumu');

  // Fabrika üretim/veri referans tarihi
  const effectiveDate = useMemo(() => getEffectiveProductionDate(arizalar), [arizalar]);

  // ERTESİ GÜN (24:00 GEÇTİKTEN SONRAKİLER) ESKİ ARIZA:
  // Kullanıcı Kuralı: "şöyle yapıyorsun ertesigün yani 24:00 dan sonrakiler eski arızalr oluyor"
  // Gece 24:00 geçilip ertesi güne girildiğinde önceki günlerin tüm arızaları eski arıza olur.
  // Aktif: Sadece bugünün takvim gününe (00:00:00 - 23:59:59) ait açık arızalar
  // Eski: 24:00 öncesinden ertesi güne sarkanlar veya çözülen/tamamlananlar
  const { activeArizalar, oldArizalar } = useMemo(() => {
    const active: Ariza[] = [];
    const old: Ariza[] = [];

    arizalar.forEach((a) => {
      // 1. Çözüldü veya Tamamlandı ise doğrudan eski arızadır
      if (a.status === 'Tamamlandı' || a.status === 'Çözüldü') {
        old.push(a);
        return;
      }

      // 2. 24:00 sonrası ertesi güne girildiğinde dünden kalan arızalar eski arıza olur:
      const isToday = isCreatedToday(a.createdAt, effectiveDate, new Date());
      if (!isToday) {
        old.push(a);
        return;
      }

      // Bugün açılmış ve henüz tamamlanmamış açık arızalar
      active.push(a);
    });

    return { activeArizalar: active, oldArizalar: old };
  }, [arizalar, effectiveDate]);

  // Arızaları iş türüne göre gruplama fonksiyonu
  interface JobGroup {
    key: string;
    name: string;
    hex: string;
    textColor: string;
    items: Ariza[];
  }

  const groupListByJobType = (list: Ariza[]): JobGroup[] => {
    const groupsMap: Record<string, JobGroup> = {
      is_guvenligi: {
        key: 'is_guvenligi',
        name: 'İŞ GÜVENLİĞİ',
        hex: '#FF0000',
        textColor: '#FFFFFF',
        items: [],
      },
      elektrik: {
        key: 'elektrik',
        name: 'ELEKTRİK ARIZALARI',
        hex: '#FFFF00',
        textColor: '#000000',
        items: [],
      },
      mekanik: {
        key: 'mekanik',
        name: 'MEKANİK ARIZALARI',
        hex: '#00FFFF',
        textColor: '#000000',
        items: [],
      },
      planli_bakim: {
        key: 'planli_bakim',
        name: 'PLANLI BAKIM',
        hex: '#FFA500',
        textColor: '#000000',
        items: [],
      },
      tekrar_eden: {
        key: 'tekrar_eden',
        name: 'TEKRAR EDEN ARIZALAR',
        hex: '#FF99FF',
        textColor: '#000000',
        items: [],
      },
      diger: {
        key: 'diger',
        name: 'GENEL BAKIM & DİĞER',
        hex: '#E2E8F0',
        textColor: '#000000',
        items: [],
      },
    };

    list.forEach((item) => {
      const config = getJobTypeConfig(item.jobType);
      const key = config.key || 'diger';
      if (!groupsMap[key]) {
        groupsMap[key] = {
          key,
          name: (config.name || key).toUpperCase(),
          hex: config.hex,
          textColor: config.textColor,
          items: [],
        };
      }
      groupsMap[key].items.push(item);
    });

    // Her grup içindeki kayıtları sırala: en yeni gelen en üstte
    Object.values(groupsMap).forEach((g) => {
      g.items.sort((a, b) => getSortTimestamp(b) - getSortTimestamp(a));
    });

    // Grupları öncelik sırasına göre diz ve sadece kaydı olanları döndür
    const preferredOrder = ['is_guvenligi', 'elektrik', 'mekanik', 'planli_bakim', 'tekrar_eden', 'diger'];
    const result: JobGroup[] = [];

    preferredOrder.forEach((key) => {
      if (groupsMap[key] && groupsMap[key].items.length > 0) {
        result.push(groupsMap[key]);
      }
    });

    Object.keys(groupsMap).forEach((key) => {
      if (!preferredOrder.includes(key) && groupsMap[key].items.length > 0) {
        result.push(groupsMap[key]);
      }
    });

    return result;
  };

  const activeGroups = useMemo(() => groupListByJobType(activeArizalar), [activeArizalar, sessionNewArrivalIds]);
  const oldGroups = useMemo(() => groupListByJobType(oldArizalar), [oldArizalar]);

  // Sayaçlar (Fabrika TV Panosu)
  const allUnresolved = useMemo(
    () => arizalar.filter((a) => a.status !== 'Tamamlandı' && a.status !== 'Çözüldü'),
    [arizalar]
  );
  const totalOpen = allUnresolved.length;

  const activeInterventionsCount = useMemo(
    () =>
      allUnresolved.filter((a) => {
        const s = (a.status || '').toLowerCase();
        return (
          s.includes('müdahale') ||
          s.includes('mudahale') ||
          s.includes('işlem') ||
          s.includes('islem') ||
          Boolean(a.startedBy)
        );
      }).length,
    [allUnresolved]
  );

  const waitingPartsCount = useMemo(
    () => allUnresolved.filter((a) => a.status === 'Parça Bekliyor').length,
    [allUnresolved]
  );

  // Bugün / 1 günden yeni açık arızalar
  const todayCount = activeArizalar.length;

  // 1 günün üzerindeki açık arızalar (önceki günlerden devreden açıklar)
  const pendingPreviousDaysCount = useMemo(
    () => oldArizalar.filter((a) => a.status !== 'Tamamlandı' && a.status !== 'Çözüldü').length,
    [oldArizalar]
  );

  return (
    <div className="h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none overflow-hidden">
      {/* ÜST MENÜ: Kompakt, köşeli, temel göstergeler */}
      <TvHeader
        totalOpen={totalOpen}
        activeInterventionsCount={activeInterventionsCount}
        todayCount={todayCount}
        pendingPreviousDaysCount={pendingPreviousDaysCount}
        waitingPartsCount={waitingPartsCount}
        isOnline={isOnline}
        lastSyncTime={lastSyncTime}
        onRefresh={handleManualRefresh}
        autoScroll={autoScroll}
        onToggleAutoScroll={() => setAutoScroll(!autoScroll)}
      />

      {/* ANLIK CANLI YENİ ARIZA DÜŞTÜ BİLDİRİM BANNERI (Köşeli) */}
      {newArrivalAlert && (
        <div className="bg-red-600 text-white px-3 py-1.5 flex items-center justify-between gap-3 border-b-2 border-black rounded-none shrink-0 z-30 shadow-lg">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="bg-black text-yellow-300 text-xs font-black uppercase px-2 py-0.5 rounded-none tracking-wider shrink-0 animate-pulse">
              ⚡ YENİ ARIZA DÜŞTÜ
            </span>
            <span className="text-xs font-mono text-slate-200 shrink-0">
              {formatTimeOnly(newArrivalAlert.createdAt)}
            </span>
            <span className="text-xs font-black truncate text-white">
              {newArrivalAlert.machine} • {newArrivalAlert.jobType}
            </span>
            <span className="hidden md:inline text-xs text-white/90 truncate max-w-md">
              {newArrivalAlert.description}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                setSelectedAriza(newArrivalAlert);
                setNewArrivalAlert(null);
              }}
              className="px-2.5 py-0.5 rounded-none bg-black text-white font-black text-xs hover:bg-slate-900 transition-colors border border-white/20 uppercase"
            >
              Görüntüle
            </button>
            <button
              onClick={() => setNewArrivalAlert(null)}
              className="p-1 hover:bg-black/30 rounded-none transition-colors text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* TABLO SÜTUN BAŞLIKLARI VE GÖRÜNÜM SEÇİCİ (Köşeli, Kompakt, Hizalı) */}
      <div className="bg-slate-900 border-b border-black text-[11px] font-bold uppercase text-slate-300 px-2 sm:px-3 py-1 flex items-center justify-between gap-2 tracking-wider rounded-none shrink-0 z-10 shadow-xs">
        {/* Sol Kısım: Görünüm Seçici (Tümü / Aktif / Eski) + Hizalı Başlıklar */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="inline-flex rounded-none border border-black bg-black/60 p-0.5 gap-0.5 shrink-0">
            <button
              onClick={() => setViewMode('tumu')}
              className={`px-2 py-0.5 rounded-none text-[11px] font-bold uppercase tracking-wider transition-colors ${
                viewMode === 'tumu'
                  ? 'bg-amber-500 text-black'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              TÜMÜ ({arizalar.length})
            </button>
            <button
              onClick={() => setViewMode('aktif')}
              className={`px-2 py-0.5 rounded-none text-[11px] font-bold uppercase tracking-wider transition-colors ${
                viewMode === 'aktif'
                  ? 'bg-red-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              AKTİF ({activeArizalar.length})
            </button>
            <button
              onClick={() => setViewMode('eski')}
              className={`px-2 py-0.5 rounded-none text-[11px] font-bold uppercase tracking-wider transition-colors ${
                viewMode === 'eski'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              ESKİ ARIZALAR ({oldArizalar.length})
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-[11px] font-bold text-slate-400 truncate">
            <span className="w-36 sm:w-48 lg:w-56 truncate">MAKİNE</span>
            <span>|</span>
            <span className="truncate">ARIZA AÇIKLAMASI</span>
          </div>
        </div>

        {/* Sağ Kısım Sütun Başlıkları */}
        <div className="flex items-center gap-3 shrink-0 text-right text-[11px] font-bold text-slate-400 uppercase">
          <span className="hidden md:inline">ARIZA TÜRÜ</span>
          <span className="hidden sm:inline">GÖREVLİ</span>
          <span className="w-24 text-right">SÜRE / SAAT</span>
        </div>
      </div>

      {/* ANA SATIR LİSTESİ: İŞ TÜRÜNE GÖRE GRUPLANMIŞ, ESKİ ARIZALAR AYRILMIŞ, TÜM YAZILAR AYNI VE KÜÇÜK */}
      <main
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto bg-slate-950 scroll-smooth"
      >
        {/* 1. AKTİF ARIZALAR BÖLÜMÜ (Tümü veya Aktif seçiliyse) */}
        {(viewMode === 'tumu' || viewMode === 'aktif') && (
          <div>
            {/* Tümü seçiliyse ana bölüm başlığı */}
            {viewMode === 'tumu' && (
              <div className="bg-slate-950 border-b border-black text-[11px] font-bold uppercase text-red-400 px-2.5 sm:px-3 py-0.5 flex items-center justify-between tracking-wider">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-red-500 animate-pulse" />
                  <span>AKTİF ARIZALAR (BUGÜN • İŞ TÜRÜNE GÖRE GRUPLU • {activeArizalar.length} KAYIT)</span>
                </div>
              </div>
            )}

            {activeGroups.length === 0 ? (
              <div className="p-4 text-center text-[11px] font-bold text-slate-500 uppercase tracking-wider bg-slate-950">
                Şu an bugüne ait bekleyen veya işlem gören aktif arıza kaydı bulunmuyor.
              </div>
            ) : (
              activeGroups.map((group) => (
                <div key={`active-${group.key}`} className="w-full">
                  {/* İŞ TÜRÜ GRUP BAŞLIĞI (Köşeli, Kompakt, Renk Göstergeli) */}
                  <div
                    className="border-b border-black text-[11px] font-bold uppercase px-2.5 sm:px-3 py-0.5 flex items-center justify-between tracking-wider bg-slate-900 text-slate-200"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 inline-block shrink-0 border border-black"
                        style={{ backgroundColor: group.hex }}
                      />
                      <span className="text-white">{group.name}</span>
                      <span className="text-slate-400 font-mono text-[11px]">({group.items.length})</span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">
                      {group.items.length} Açık Kayıt
                    </span>
                  </div>

                  {/* Bu gruptaki satırlar (Boşluksuz, Dar, Köşeli, Aynı Font Boyutu) */}
                  <div className="flex flex-col w-full divide-y-0">
                    {group.items.map((ariza) => (
                      <ArizaRow
                        key={ariza.id}
                        ariza={ariza}
                        isOld={false}
                        isNewArrival={sessionNewArrivalIds.has(ariza.id)}
                        onSelect={(a) => setSelectedAriza(a)}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* 2. ESKİ / TAMAMLANAN ARIZALAR BÖLÜMÜ (24:00 Öncesinden Devredenler & Çözülenler) */}
        {(viewMode === 'tumu' || viewMode === 'eski') && (
          <div className={viewMode === 'tumu' ? 'mt-2 border-t-2 border-black' : ''}>
            {/* Eski Arızalar Belirgin Ayırıcı Başlığı */}
            <div className="bg-slate-900 border-y-2 border-emerald-500/50 text-[11px] font-bold uppercase text-emerald-400 px-2.5 sm:px-3 py-1 flex items-center justify-between tracking-wider shadow-xs">
              <div className="flex items-center gap-2">
                <span>ESKİ ARIZALAR (24:00 ÖNCESİNDEN DEVREDENLER & ARŞİV • {oldArizalar.length} KAYIT - İŞ TÜRÜNE GÖRE AYRILMIŞTIR)</span>
              </div>
              <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">
                DEVREDEN & GEÇMİŞ
              </span>
            </div>

            {oldGroups.length === 0 ? (
              <div className="p-4 text-center text-[11px] font-bold text-slate-500 uppercase tracking-wider bg-slate-950">
                24:00 öncesinden devreden veya tamamlanmış eski arıza bulunmuyor.
              </div>
            ) : (
              oldGroups.map((group) => (
                <div key={`old-${group.key}`} className="w-full">
                  {/* Eski Grup Başlığı (Sade, Kompakt, Kayıt Sayılı) */}
                  <div
                    className="border-b border-black text-[10px] font-bold uppercase px-2.5 sm:px-3 py-0.5 flex items-center justify-between tracking-wider bg-slate-950/95 text-slate-400"
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 inline-block shrink-0 border border-black"
                        style={{ backgroundColor: group.hex }}
                      />
                      <span className="text-slate-200">{group.name}</span>
                      <span className="text-slate-400 font-mono text-[10px]">({group.items.length})</span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400 hidden sm:inline">
                      {group.items.length} Kayıt
                    </span>
                  </div>

                  {/* Bu gruptaki eski satırlar: Boyut ve stil aynı, küçük text-[11px], font-bold */}
                  <div className="flex flex-col w-full divide-y-0">
                    {group.items.map((ariza) => (
                      <ArizaRow
                        key={ariza.id}
                        ariza={ariza}
                        isOld={true}
                        isNewArrival={false}
                        onSelect={(a) => setSelectedAriza(a)}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>

      {/* ALT ÇUBUK: Minimal, köşeli */}
      <footer className="bg-slate-950 border-t border-slate-900 px-3 py-1 text-xs text-slate-400 flex items-center justify-between gap-2 rounded-none">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-bold text-white uppercase tracking-wider">
            TOPLAM: {arizalar.length} KAYIT (AKTİF: {activeArizalar.length} • ESKİ: {oldArizalar.length})
          </span>
          <span>•</span>
          <span className="text-slate-400">İş Türüne Göre Gruplandı & Ayrıldı</span>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs text-slate-400">
          <span className="w-2 h-2 rounded-none bg-emerald-400 animate-pulse inline-block" />
          <span>CANLI AKIŞ AKTİF</span>
        </div>
      </footer>

      {/* DETAY İNCELEME MODALI */}
      {selectedAriza && (
        <ArizaDetailModal
          ariza={selectedAriza}
          onClose={() => setSelectedAriza(null)}
        />
      )}
    </div>
  );
}
