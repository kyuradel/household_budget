(function () {
  'use strict';

  // ---------- DOM refs ----------
  const uploadSection = document.getElementById('upload-section');
  const mappingSection = document.getElementById('mapping-section');
  const resultsSection = document.getElementById('results-section');
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const uploadError = document.getElementById('upload-error');
  const mappingError = document.getElementById('mapping-error');
  const dateSel = document.getElementById('map-date');
  const merchantSel = document.getElementById('map-merchant');
  const amountSel = document.getElementById('map-amount');
  const categorySel = document.getElementById('map-category');
  const previewTable = document.getElementById('preview-table');
  const analyzeBtn = document.getElementById('analyze-btn');
  const resetBtn = document.getElementById('reset-btn');
  const resetBtn2 = document.getElementById('reset-btn-2');
  const heroValue = document.getElementById('hero-value');
  const statStrip = document.getElementById('stat-strip');
  const metaPeriod = document.getElementById('meta-period');
  const metaCount = document.getElementById('meta-count');
  const metaCategories = document.getElementById('meta-categories');
  const metaGenerated = document.getElementById('meta-generated');
  const automapNote = document.getElementById('automap-note');
  const automapText = document.getElementById('automap-text');
  const remapBtn = document.getElementById('remap-btn');
  const skippedNote = document.getElementById('skipped-note');
  const topbarStep = document.getElementById('topbar-step');

  let currentRows = null;

  // ---------- small utils ----------
  function truncate(str, n) {
    str = String(str);
    return str.length > n ? str.slice(0, n - 1) + '…' : str;
  }

  function formatKRW(n) {
    const sign = n < 0 ? '-' : '';
    return sign + '₩' + Math.abs(Math.round(n)).toLocaleString('ko-KR');
  }

  function formatCompactKRW(n) {
    const sign = n < 0 ? '-' : '';
    n = Math.abs(n);
    if (n >= 100000000) {
      const v = n / 100000000;
      return sign + (n % 100000000 === 0 ? v.toFixed(0) : v.toFixed(1)) + '억원';
    }
    if (n >= 10000) {
      const v = n / 10000;
      return sign + (n % 10000 === 0 ? v.toFixed(0) : v.toFixed(1)) + '만원';
    }
    return sign + Math.round(n).toLocaleString('ko-KR') + '원';
  }

  function fmtDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function fmtDateShort(d) {
    const y = String(d.getFullYear()).slice(2);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}.${m}.${day}`;
  }

  function monthKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function fmtMonth(key) {
    const parts = key.split('-');
    return `${parts[0].slice(2)}.${parts[1]}`;
  }

  // ---------- encoding + CSV parsing ----------
  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('read error'));
      reader.onload = () => {
        const buf = reader.result;
        try {
          resolve(new TextDecoder('utf-8', { fatal: true }).decode(buf));
        } catch (e) {
          try {
            resolve(new TextDecoder('euc-kr').decode(buf));
          } catch (e2) {
            resolve(new TextDecoder('utf-8').decode(buf));
          }
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function detectDelimiter(firstLine) {
    const counts = { ',': 0, '\t': 0, ';': 0 };
    for (const ch of firstLine) if (ch in counts) counts[ch]++;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted[0][1] > 0 ? sorted[0][0] : ',';
  }

  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const firstLineEnd = text.indexOf('\n');
    const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
    const delim = detectDelimiter(firstLine);

    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === delim) {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += c;
      }
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
  }

  // ---------- column guessing ----------
  const ROLE_ALIASES = {
    date: ['거래일자', '이용일자', '승인일자', '결제일자', '매출일자', '날짜', '이용일', '거래일', '승인일', '일자', 'date'],
    merchant: ['가맹점명', '가맹점', '이용가맹점', '사용처', '거래내용', '상호', '내용', 'merchant', 'store', 'description', 'payee'],
    amount: ['이용금액', '승인금액', '결제금액', '거래금액', '청구금액', '금액', '결제액', '사용금액', 'amount', 'price', 'total'],
    category: ['업종', '가맹점업종', '카테고리', '분류', 'category', 'type'],
  };

  function normalizeHeader(h) {
    return String(h == null ? '' : h).replace(/\s+/g, '').toLowerCase();
  }

  function scoreHeader(normHeader, aliases) {
    let best = 0;
    if (!normHeader) return 0;
    for (const a of aliases) {
      const al = a.toLowerCase();
      if (normHeader === al) best = Math.max(best, 3);
      else if (normHeader.includes(al) || al.includes(normHeader)) best = Math.max(best, 2);
    }
    return best;
  }

  function guessColumns(headers) {
    const norm = headers.map(normalizeHeader);
    const used = new Set();
    const result = {};
    const scores = {};
    for (const role of ['amount', 'date', 'merchant', 'category']) {
      let bestIdx = -1;
      let bestScore = 0;
      for (let i = 0; i < norm.length; i++) {
        if (used.has(i)) continue;
        const sc = scoreHeader(norm[i], ROLE_ALIASES[role]);
        if (sc > bestScore) {
          bestScore = sc;
          bestIdx = i;
        }
      }
      scores[role] = bestScore;
      if (bestScore > 0) {
        result[role] = bestIdx;
        used.add(bestIdx);
      } else {
        result[role] = -1;
      }
    }
    result.scores = scores;
    return result;
  }

  // ---------- value parsing ----------
  function parseDate(raw) {
    if (raw === undefined || raw === null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    const m = s.match(/(\d{4})[.\-/]?(\d{1,2})[.\-/]?(\d{1,2})/);
    if (!m) return null;
    const y = +m[1];
    const mo = +m[2];
    const d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, mo - 1, d);
    if (isNaN(dt.getTime())) return null;
    return dt;
  }

  function parseAmount(raw) {
    if (raw === undefined || raw === null) return null;
    let s = String(raw).trim();
    if (!s) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) {
      neg = true;
      s = s.slice(1, -1);
    }
    s = s.replace(/[^\d.\-]/g, '');
    if (!s || s === '-' || s === '.') return null;
    const v = parseFloat(s);
    if (isNaN(v)) return null;
    return neg ? -Math.abs(v) : v;
  }

  // ---------- auto categorization ----------
  const CATEGORIES = [
    { name: '식비', keywords: ['식당', '분식', '치킨', '피자', '버거', '김밥', '국밥', '고기', '삼겹살', '초밥', '중식', '일식', '한식', '국수', '냉면', '곱창', '족발', '보쌈', '배달의민족', '요기요', '쿠팡이츠'] },
    { name: '카페/간식', keywords: ['카페', '커피', '스타벅스', '이디야', '투썸', '빽다방', '메가커피', '베이커리', '빵집', '도넛', '아이스크림', '디저트'] },
    { name: '교통', keywords: ['택시', '버스', '지하철', '주유', '충전소', '톨게이트', '대리운전', '주차', 'ktx', 'srt'] },
    { name: '편의점/마트', keywords: ['gs25', 'cu', '세븐일레븐', '편의점', '이마트', '홈플러스', '롯데마트', '마트', '코스트코'] },
    { name: '쇼핑', keywords: ['백화점', '아울렛', '올리브영', '다이소', '쿠팡', '마켓컬리', '의류', '신발', '화장품'] },
    { name: '문화/여가', keywords: ['영화', 'cgv', '메가박스', '공연', '전시', '헬스', '골프', '여행', '호텔', '숙박'] },
    { name: '통신/구독', keywords: ['통신', 'skt', 'kt', '유플러스', '넷플릭스', '유튜브', '멜론', '구독'] },
    { name: '의료/건강', keywords: ['병원', '의원', '약국', '한의원', '치과', '검진'] },
  ];

  function categorize(name) {
    const n = String(name).toLowerCase();
    for (const cat of CATEGORIES) {
      for (const kw of cat.keywords) {
        if (n.includes(kw)) return cat.name;
      }
    }
    return '기타';
  }

  // ---------- chart renderers (flat ruled bars, no SVG) ----------
  function renderHBars(container, items) {
    container.innerHTML = '';
    if (!items.length) {
      container.textContent = '표시할 데이터가 없습니다.';
      return;
    }
    const maxVal = Math.max(...items.map((i) => i.amount)) || 1;
    const wrap = document.createElement('div');
    wrap.className = 'hbars';
    items.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'hbar-row' + (i === 0 ? ' top' : '');
      row.tabIndex = 0;
      row.title = `${item.name} · ${formatKRW(item.amount)}${item.count ? ' · ' + item.count + '건' : ''}`;

      const label = document.createElement('div');
      label.className = 'hbar-label';
      label.textContent = item.name;

      const track = document.createElement('div');
      track.className = 'hbar-track';
      const fill = document.createElement('div');
      fill.className = 'hbar-fill';
      fill.style.width = Math.max(2, (item.amount / maxVal) * 100) + '%';
      track.appendChild(fill);

      const val = document.createElement('div');
      val.className = 'hbar-value';
      val.textContent = formatCompactKRW(item.amount);

      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(val);
      wrap.appendChild(row);
    });
    container.appendChild(wrap);
  }

  function renderVBars(container, items) {
    container.innerHTML = '';
    if (!items.length) {
      container.textContent = '표시할 데이터가 없습니다.';
      return;
    }
    const maxVal = Math.max(...items.map((i) => i.amount)) || 1;
    const bars = document.createElement('div');
    bars.className = 'vbars';
    const labels = document.createElement('div');
    labels.className = 'vbar-labels';

    items.forEach((item, i) => {
      const isLast = i === items.length - 1;
      const col = document.createElement('div');
      col.className = 'vbar-col' + (isLast ? ' latest' : '');
      col.tabIndex = 0;
      col.title = `${fmtMonth(item.key)} · ${formatKRW(item.amount)}`;

      const val = document.createElement('div');
      val.className = 'vbar-value';
      val.textContent = formatCompactKRW(item.amount);

      const track = document.createElement('div');
      track.className = 'vbar-track';
      const fill = document.createElement('div');
      fill.className = 'vbar-fill';
      fill.style.height = Math.max(2, (item.amount / maxVal) * 100) + '%';
      track.appendChild(fill);

      col.appendChild(val);
      col.appendChild(track);
      bars.appendChild(col);

      const lbl = document.createElement('div');
      lbl.textContent = fmtMonth(item.key);
      labels.appendChild(lbl);
    });

    container.appendChild(bars);
    container.appendChild(labels);
  }

  function renderCategoryChart(items) {
    renderHBars(document.getElementById('category-chart'), items);
  }

  function renderMerchantChart(items) {
    renderHBars(document.getElementById('merchant-chart'), items);
  }

  function renderMonthlyChart(items) {
    renderVBars(document.getElementById('monthly-chart'), items);
  }

  // ---------- table renderers ----------
  function buildHeaderRow(table, labels, numFromIdx) {
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    labels.forEach((h, i) => {
      const th = document.createElement('th');
      if (i >= numFromIdx) th.className = 'num';
      th.textContent = h;
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);
  }

  function renderCategoryTable(items, total) {
    const table = document.getElementById('category-table');
    table.innerHTML = '';
    buildHeaderRow(table, ['카테고리', '금액', '비율', '건수'], 1);
    const tbody = document.createElement('tbody');
    items.forEach((item) => {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.textContent = item.name;
      const tdAmt = document.createElement('td');
      tdAmt.className = 'num';
      tdAmt.textContent = formatKRW(item.amount);
      const tdPct = document.createElement('td');
      tdPct.className = 'num';
      tdPct.textContent = (total > 0 ? (item.amount / total) * 100 : 0).toFixed(1) + '%';
      const tdCnt = document.createElement('td');
      tdCnt.className = 'num';
      tdCnt.textContent = item.count + '건';
      tr.appendChild(tdName);
      tr.appendChild(tdAmt);
      tr.appendChild(tdPct);
      tr.appendChild(tdCnt);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  function renderMerchantTable(items) {
    const table = document.getElementById('merchant-table');
    table.innerHTML = '';
    buildHeaderRow(table, ['가맹점', '금액', '건수'], 1);
    const tbody = document.createElement('tbody');
    items.forEach((item) => {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.textContent = item.name;
      const tdAmt = document.createElement('td');
      tdAmt.className = 'num';
      tdAmt.textContent = formatKRW(item.amount);
      const tdCnt = document.createElement('td');
      tdCnt.className = 'num';
      tdCnt.textContent = item.count + '건';
      tr.appendChild(tdName);
      tr.appendChild(tdAmt);
      tr.appendChild(tdCnt);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  function renderMonthlyTable(items) {
    const table = document.getElementById('monthly-table');
    table.innerHTML = '';
    buildHeaderRow(table, ['월', '금액', '전월 대비'], 1);
    const tbody = document.createElement('tbody');
    items.forEach((item, i) => {
      const tr = document.createElement('tr');
      const tdMonth = document.createElement('td');
      tdMonth.textContent = fmtMonth(item.key);
      const tdAmt = document.createElement('td');
      tdAmt.className = 'num';
      tdAmt.textContent = formatKRW(item.amount);
      const tdDelta = document.createElement('td');
      tdDelta.className = 'num';
      if (i === 0 || items[i - 1].amount === 0) {
        tdDelta.textContent = '-';
      } else {
        const pct = ((item.amount - items[i - 1].amount) / items[i - 1].amount) * 100;
        tdDelta.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
      }
      tr.appendChild(tdMonth);
      tr.appendChild(tdAmt);
      tr.appendChild(tdDelta);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  function renderTopTxTable(list) {
    const table = document.getElementById('top-tx-table');
    table.innerHTML = '';
    buildHeaderRow(table, ['날짜', '가맹점', '카테고리', '금액'], 3);
    const tbody = document.createElement('tbody');
    list.forEach((r) => {
      const tr = document.createElement('tr');
      const tdDate = document.createElement('td');
      tdDate.textContent = fmtDate(r.date);
      const tdM = document.createElement('td');
      tdM.textContent = r.merchant;
      const tdC = document.createElement('td');
      tdC.textContent = r.category;
      const tdA = document.createElement('td');
      tdA.className = 'num';
      tdA.textContent = formatKRW(r.amount);
      tr.appendChild(tdDate);
      tr.appendChild(tdM);
      tr.appendChild(tdC);
      tr.appendChild(tdA);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  // ---------- Hero summary ----------
  function statItem(koLabel, enLabel, value, note) {
    const div = document.createElement('div');
    const p1 = document.createElement('p');
    p1.className = 'stat-label';
    p1.appendChild(document.createTextNode(koLabel + ' '));
    const en = document.createElement('span');
    en.className = 'en';
    en.textContent = enLabel;
    p1.appendChild(en);
    const p2 = document.createElement('p');
    p2.className = 'stat-value';
    p2.textContent = value;
    if (note) {
      const small = document.createElement('span');
      small.className = 'stat-note';
      small.textContent = note;
      p2.appendChild(small);
    }
    div.appendChild(p1);
    div.appendChild(p2);
    return div;
  }

  function fmtGenerated(d) {
    const y = String(d.getFullYear()).slice(2);
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const h24 = d.getHours();
    const ampm = h24 < 12 ? '오전' : '오후';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}.${m}.${day} ${ampm} ${h12}:${min}`;
  }

  function renderKPIs(d) {
    heroValue.textContent = Math.round(d.totalExpense).toLocaleString('ko-KR');

    metaPeriod.textContent = `${fmtDateShort(d.dateMin)} ~ ${fmtDateShort(d.dateMax)}`;
    metaCount.textContent = d.expenseCount.toLocaleString('ko-KR') + '건';
    metaCategories.textContent = d.categoryItems.length + '종';
    metaGenerated.textContent = fmtGenerated(new Date());

    statStrip.innerHTML = '';
    statStrip.appendChild(statItem('일 평균', 'DAILY AVG', formatKRW(Math.round(d.dailyAvg))));
    statStrip.appendChild(statItem('건당 평균', 'PER TX', formatKRW(Math.round(d.avgExpense))));
    statStrip.appendChild(statItem('최대 거래', 'LARGEST', formatKRW(d.maxTx.amount), truncate(d.maxTx.merchant, 14)));
    if (d.refundCount > 0) {
      statStrip.appendChild(statItem('환불/취소', 'REFUNDS', d.refundCount + '건', '-' + formatKRW(d.refundTotal)));
    }

    if (d.skipped > 0) {
      skippedNote.hidden = false;
      skippedNote.textContent = `※ ${d.skipped}건은 날짜/금액/가맹점 형식이 맞지 않아 분석에서 제외되었습니다.`;
    } else {
      skippedNote.hidden = true;
    }
  }

  // ---------- mapping UI ----------
  function populateSelect(selectEl, headers, selectedIdx, includeNone) {
    selectEl.innerHTML = '';
    if (includeNone) {
      const opt = document.createElement('option');
      opt.value = '-1';
      opt.textContent = '-- 없음 (자동 분류) --';
      selectEl.appendChild(opt);
    }
    headers.forEach((h, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = h && String(h).trim() ? h : `(컬럼 ${i + 1})`;
      selectEl.appendChild(opt);
    });
    selectEl.value = String(selectedIdx);
  }

  function setupMapping(rows) {
    const headers = rows[0];
    const guesses = guessColumns(headers);
    populateSelect(dateSel, headers, guesses.date < 0 ? 0 : guesses.date, false);
    populateSelect(merchantSel, headers, guesses.merchant < 0 ? 0 : guesses.merchant, false);
    populateSelect(amountSel, headers, guesses.amount < 0 ? 0 : guesses.amount, false);
    populateSelect(categorySel, headers, guesses.category, true);

    previewTable.innerHTML = '';
    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    headers.forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h || '';
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    previewTable.appendChild(thead);
    const tbody = document.createElement('tbody');
    rows.slice(1, 6).forEach((row) => {
      const tr = document.createElement('tr');
      headers.forEach((_, i) => {
        const td = document.createElement('td');
        td.textContent = row[i] !== undefined ? row[i] : '';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    previewTable.appendChild(tbody);
    return guesses;
  }

  // ---------- data processing ----------
  function processData(rows, map) {
    const dataRows = rows.slice(1);
    const records = [];
    let skipped = 0;
    for (const row of dataRows) {
      if (!row || row.every((c) => c === '' || c === undefined)) continue;
      const rawDate = row[map.dateIdx];
      const rawMerchant = row[map.merchantIdx];
      const rawAmount = row[map.amountIdx];
      const rawCategory = map.categoryIdx >= 0 ? row[map.categoryIdx] : '';
      const date = parseDate(rawDate);
      const amount = parseAmount(rawAmount);
      const merchant = (rawMerchant || '').toString().trim();
      if (!date || amount === null || !merchant) {
        skipped++;
        continue;
      }
      const category = (rawCategory || '').toString().trim() || categorize(merchant);
      records.push({ date, merchant, amount, category });
    }

    if (records.length === 0) {
      return { ok: false, message: '유효한 데이터 행을 찾지 못했습니다. 컬럼 선택을 다시 확인해주세요.' };
    }

    const expenses = records.filter((r) => r.amount > 0);
    const refunds = records.filter((r) => r.amount < 0);
    if (expenses.length === 0) {
      return { ok: false, message: '분석할 수 있는 지출 내역(양수 금액)이 없습니다.' };
    }

    const totalExpense = expenses.reduce((s, r) => s + r.amount, 0);
    const expenseCount = expenses.length;
    const avgExpense = totalExpense / expenseCount;
    const maxTx = expenses.reduce((a, b) => (b.amount > a.amount ? b : a));
    const allDates = records.map((r) => r.date.getTime());
    const dateMin = new Date(Math.min(...allDates));
    const dateMax = new Date(Math.max(...allDates));
    const dayCount = Math.max(1, Math.round((dateMax - dateMin) / 86400000) + 1);
    const dailyAvg = totalExpense / dayCount;
    const refundCount = refunds.length;
    const refundTotal = refunds.reduce((s, r) => s + Math.abs(r.amount), 0);

    const catMap = new Map();
    for (const r of expenses) {
      const cur = catMap.get(r.category) || { amount: 0, count: 0 };
      cur.amount += r.amount;
      cur.count += 1;
      catMap.set(r.category, cur);
    }
    const catArr = Array.from(catMap, ([name, v]) => ({ name, amount: v.amount, count: v.count }));
    catArr.sort((a, b) => b.amount - a.amount);
    const kept = [];
    let otherAmount = 0;
    let otherCount = 0;
    for (const item of catArr) {
      if (item.name === '기타') {
        otherAmount += item.amount;
        otherCount += item.count;
        continue;
      }
      if (kept.length < 7) kept.push(item);
      else {
        otherAmount += item.amount;
        otherCount += item.count;
      }
    }
    if (otherCount > 0) kept.push({ name: '기타', amount: otherAmount, count: otherCount });
    kept.sort((a, b) => b.amount - a.amount);
    const categoryItems = kept;

    const merMap = new Map();
    for (const r of expenses) {
      const cur = merMap.get(r.merchant) || { amount: 0, count: 0 };
      cur.amount += r.amount;
      cur.count += 1;
      merMap.set(r.merchant, cur);
    }
    const merchantItems = Array.from(merMap, ([name, v]) => ({ name, amount: v.amount, count: v.count }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);

    const monMap = new Map();
    for (const r of expenses) {
      const key = monthKey(r.date);
      monMap.set(key, (monMap.get(key) || 0) + r.amount);
    }
    const monthlyItems = Array.from(monMap, ([key, amount]) => ({ key, amount })).sort((a, b) => a.key.localeCompare(b.key));

    const topTx = expenses
      .slice()
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);

    return {
      ok: true,
      data: {
        totalExpense,
        expenseCount,
        avgExpense,
        dailyAvg,
        maxTx,
        dateMin,
        dateMax,
        refundCount,
        refundTotal,
        skipped,
        categoryItems,
        merchantItems,
        monthlyItems,
        topTx,
      },
    };
  }

  function renderAll(data) {
    renderKPIs(data);
    renderCategoryChart(data.categoryItems);
    renderCategoryTable(data.categoryItems, data.totalExpense);
    renderMerchantChart(data.merchantItems);
    renderMerchantTable(data.merchantItems);
    renderMonthlyChart(data.monthlyItems);
    renderMonthlyTable(data.monthlyItems);
    renderTopTxTable(data.topTx);
  }

  // ---------- app flow ----------
  const STEP_LABELS = { 1: '업로드', 2: '컬럼 확인', 3: '분석 결과' };
  function setStep(n) {
    topbarStep.textContent = `STEP 0${n}/03 · ${STEP_LABELS[n]}`;
  }

  let currentHeaders = null;

  function showMappingStep() {
    uploadSection.hidden = true;
    resultsSection.hidden = true;
    mappingSection.hidden = false;
    mappingError.hidden = true;
    setStep(2);
  }

  function runAnalysis(colMap) {
    const result = processData(currentRows, colMap);
    if (!result.ok) {
      mappingError.textContent = result.message;
      mappingError.hidden = false;
      showMappingStep();
      return false;
    }
    uploadSection.hidden = true;
    mappingSection.hidden = true;
    resultsSection.hidden = false;
    setStep(3);
    renderAll(result.data);
    return true;
  }

  async function handleFile(file) {
    uploadError.hidden = true;
    try {
      const text = await readFileAsText(file);
      const rows = parseCSV(text);
      if (!rows.length || rows.length < 2) throw new Error('empty');
      currentRows = rows;
      currentHeaders = rows[0];
      const guesses = setupMapping(rows);

      const confident = guesses.scores.date >= 3 && guesses.scores.merchant >= 3 && guesses.scores.amount >= 3;

      if (confident) {
        const colMap = { dateIdx: guesses.date, merchantIdx: guesses.merchant, amountIdx: guesses.amount, categoryIdx: guesses.category };
        const ok = runAnalysis(colMap);
        if (ok) {
          const parts = [`날짜: ${currentHeaders[colMap.dateIdx]}`, `가맹점: ${currentHeaders[colMap.merchantIdx]}`, `금액: ${currentHeaders[colMap.amountIdx]}`];
          if (colMap.categoryIdx >= 0) parts.push(`카테고리: ${currentHeaders[colMap.categoryIdx]}`);
          automapText.textContent = `컬럼을 자동으로 인식했어요 · ${parts.join(' · ')}`;
          automapNote.hidden = false;
          resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } else {
        automapNote.hidden = true;
        showMappingStep();
      }
    } catch (err) {
      uploadError.textContent = 'CSV 파일을 읽는 중 문제가 발생했습니다. 파일 형식을 확인해주세요.';
      uploadError.hidden = false;
    }
  }

  function resetApp() {
    currentRows = null;
    currentHeaders = null;
    fileInput.value = '';
    uploadSection.hidden = false;
    mappingSection.hidden = true;
    resultsSection.hidden = true;
    automapNote.hidden = true;
    uploadError.hidden = true;
    mappingError.hidden = true;
    previewTable.innerHTML = '';
    setStep(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  fileInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) handleFile(f);
  });

  analyzeBtn.addEventListener('click', () => {
    mappingError.hidden = true;
    const dateIdx = +dateSel.value;
    const merchantIdx = +merchantSel.value;
    const amountIdx = +amountSel.value;
    const categoryIdx = +categorySel.value;
    if (dateIdx < 0 || merchantIdx < 0 || amountIdx < 0) {
      mappingError.textContent = '날짜/가맹점/금액 컬럼을 모두 선택해주세요.';
      mappingError.hidden = false;
      return;
    }
    automapNote.hidden = true;
    const ok = runAnalysis({ dateIdx, merchantIdx, amountIdx, categoryIdx });
    if (ok) resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  remapBtn.addEventListener('click', () => {
    automapNote.hidden = true;
    showMappingStep();
    mappingSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  resetBtn.addEventListener('click', resetApp);
  resetBtn2.addEventListener('click', resetApp);
})();
