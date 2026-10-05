const periods = [1, 7, 30];
  const windows = [1, 6, 24, 72];
  const won = (amount) => money(amount, "KRW");
  function money(amount, currency = "KRW") {
    if (amount == null) return "미확인";
    return new Intl.NumberFormat("ko-KR", { style: "currency", currency, maximumFractionDigits: currency === "USD" ? 2 : 0 }).format(amount / (currency === "USD" ? 100 : 1));
  }
  function number(value) { return value == null ? "—" : new Intl.NumberFormat("ko-KR").format(value); }
  function percent(sample, digits = 1) { return !sample || sample[1] === 0 ? "—" : `${(sample[0] / sample[1] * 100).toFixed(digits)}%`; }
  function kstDay(date) { return new Date(new Date(date).getTime() + 9 * 3600_000).toISOString().slice(0, 10); }
  function shiftDay(day, shift) { return new Date(Date.parse(`${day}T00:00:00Z`) + shift * 86400_000).toISOString().slice(0, 10); }
  function clock(date) { return date ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(date)) : "미확인"; }
  function relative(date, now) {
    const minutes = Math.max(0, Math.floor((Date.parse(now) - Date.parse(date)) / 60_000));
    return minutes < 1 ? "방금" : minutes < 60 ? `${minutes}분 전` : minutes < 1440 ? `${Math.floor(minutes / 60)}시간 전` : `${Math.floor(minutes / 1440)}일 전`;
  }
  function periodSales(snapshot, days, currency) {
    const last = kstDay(snapshot.checkedAt), first = shiftDay(last, -(days - 1));
    return snapshot.dailySales.filter(row => row.currency === currency && row.day >= first && row.day <= last);
  }
  function salesSummary(snapshot, days, currency) {
    return periodSales(snapshot, days, currency).reduce((a, row) => ({
      gross: a.gross + row.gross, refunds: a.refunds + row.refunds, count: a.count + row.count,
      newCount: a.newCount + row.newCount, renewalCount: a.renewalCount + row.renewalCount,
    }), { gross: 0, refunds: 0, count: 0, newCount: 0, renewalCount: 0 });
  }
  function routeCoverage(route, hours, checkedAt) {
    if (!route.assignedAt) return "교체 기준 미확인";
    const age = Math.max(0, (Date.parse(checkedAt) - Date.parse(route.assignedAt)) / 3600_000);
    return age < hours ? `교체 후 ${age < 1 ? `${Math.max(1, Math.floor(age * 60))}분` : `${Math.floor(age)}시간`}` : `${hours}시간 기준`;
  }
  function safeText(value = "") { return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]); }
export { periods, windows, won, money, number, percent, kstDay, shiftDay, clock, relative, periodSales, salesSummary, routeCoverage, safeText };

