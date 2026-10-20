/**
 * Date and time parsing helpers for Firestore timestamps and TV display
 */

export function parseFirestoreDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return val;

  // Firestore Timestamp instance (has toDate method)
  if (val && typeof val.toDate === 'function') {
    try {
      const d = val.toDate();
      if (d instanceof Date && !isNaN(d.getTime())) return d;
    } catch {
      // fallback to seconds below
    }
  }

  // Firestore Timestamp serialized object: { seconds: number, nanoseconds: number }
  if (typeof val === 'object' && typeof val.seconds === 'number') {
    return new Date(val.seconds * 1000);
  }

  if (typeof val === 'number') {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d;
  }

  if (typeof val === 'string') {
    // 1. Try standard ISO or RFC date string
    const parsed = new Date(val);
    if (!isNaN(parsed.getTime())) return parsed;

    // 2. Try Turkish/European format: DD.MM.YYYY HH:mm:ss or DD/MM/YYYY or DD-MM-YYYY
    const match = val.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (match) {
      const day = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      const year = parseInt(match[3], 10);
      const hour = match[4] ? parseInt(match[4], 10) : 0;
      const minute = match[5] ? parseInt(match[5], 10) : 0;
      const second = match[6] ? parseInt(match[6], 10) : 0;
      const customDate = new Date(year, month, day, hour, minute, second);
      if (!isNaN(customDate.getTime())) return customDate;
    }
  }

  return null;
}

export function formatTimeOnly(val: any): string {
  const d = parseFirestoreDate(val);
  if (!d) return '--:--';
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateFull(val: any): string {
  const d = parseFirestoreDate(val);
  if (!d) return '--.--.---- --:--';
  return d.toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Determine the effective active production date of the factory.
 * Resolves year/clock discrepancies between client TV/browser device and the database.
 */
export function getEffectiveProductionDate(
  arizalar: { createdAt?: any }[],
  clientNow: Date = new Date()
): Date {
  let latestDbDate: Date | null = null;

  for (const a of arizalar) {
    const d = parseFirestoreDate(a.createdAt);
    if (d && !isNaN(d.getTime())) {
      if (!latestDbDate || d.getTime() > latestDbDate.getTime()) {
        latestDbDate = d;
      }
    }
  }

  // If database contains records with active production dates ahead of or differing from
  // client TV clock (e.g. mock year 2026 vs real 2025, or timezone offset):
  if (latestDbDate) {
    const diffDays = Math.abs(clientNow.getTime() - latestDbDate.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > 1) {
      return latestDbDate;
    }
  }

  return clientNow;
}

/**
 * Returns elapsed time in human readable format, e.g. "2s 15dk" or "3 gün önce"
 */
export function formatElapsedTime(
  val: any,
  referenceNow?: Date
): { text: string; hours: number; isUrgent: boolean } {
  const d = parseFirestoreDate(val);
  if (!d) return { text: 'Az önce', hours: 0, isUrgent: false };

  const now = referenceNow || new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) return { text: 'Az önce', hours: 0, isUrgent: false };

  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  const days = Math.floor(hours / 24);

  let text = '';
  if (days > 0) {
    text = `${days}g ${hours % 24}s`;
  } else if (hours > 0) {
    text = `${hours}s ${minutes}dk`;
  } else {
    text = `${Math.max(1, minutes)} dk`;
  }

  const isUrgent = hours >= 4;
  return { text, hours, isUrgent };
}

/**
 * Checks if a date belongs to the reference date (same calendar day)
 */
export function isSameDay(dateVal: any, referenceDate: Date = new Date()): boolean {
  const d = parseFirestoreDate(dateVal);
  if (!d) return false;
  return (
    d.getFullYear() === referenceDate.getFullYear() &&
    d.getMonth() === referenceDate.getMonth() &&
    d.getDate() === referenceDate.getDate()
  );
}

/**
 * Kontrol: Arıza bugüne mi ait (gece 24:00 sonrası açılan güncel takvim gününe ait mi)?
 * Kullanıcı Kuralı: "Ertesi gün yani 24:00 dan sonrakiler eski arızalar oluyor"
 * Saat 24:00 geçildiğinde (ertesi güne girildiğinde) önceki günlerin arızaları eski arıza olur.
 * Sadece bugünün (00:00:00 - 23:59:59) açık arızaları bugünkü/aktif arızalardır.
 */
export function isCreatedToday(
  dateVal: any,
  referenceDate: Date = new Date(),
  clientNow: Date = new Date()
): boolean {
  // Henüz timestamp yazılmamış anlık oturum kaydı bugündür
  if (!dateVal) return true;

  const d = parseFirestoreDate(dateVal);
  if (!d || isNaN(d.getTime())) return true;

  // Fabrika referans üretim tarihi ile aynı takvim günü mü?
  const isSameRefDay =
    d.getFullYear() === referenceDate.getFullYear() &&
    d.getMonth() === referenceDate.getMonth() &&
    d.getDate() === referenceDate.getDate();

  // Cihazın bugünkü takvim tarihi ile aynı gün mü?
  const isSameClientDay =
    d.getFullYear() === clientNow.getFullYear() &&
    d.getMonth() === clientNow.getMonth() &&
    d.getDate() === clientNow.getDate();

  return isSameRefDay || isSameClientDay;
}

export const isTodayOrRecent = isCreatedToday;

/**
 * Determine current factory shift based on hour
 */
export function getCurrentShift(): string {
  const hour = new Date().getHours();
  if (hour >= 0 && hour < 8) {
    return '1.VARDİYA 00:00 // 08:00';
  } else if (hour >= 8 && hour < 16) {
    return '2.VARDİYA 08:00 // 16:00';
  } else {
    return '3.VARDİYA 16:00 // 00:00';
  }
}
