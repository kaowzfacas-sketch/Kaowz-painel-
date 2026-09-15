/* ============================================================
   CONFIGURAÇÃO DO SUPABASE — já preenchida com os dados do projeto
   wagllubpaeuizkqfvdlx (Settings > API caso precise trocar)
   ============================================================ */
const SUPABASE_URL = 'https://wagllubpaeuizkqfvdlx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndhZ2xsdWJwYWV1aXprcWZ2ZGx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0MTA0NTAsImV4cCI6MjEwNDk4NjQ1MH0.fmfvSQmXKY3gzYjb0z69Zv7pbtSbfeh3-PGpO8Fvrmo';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const TABLE = 'kaowz_plan_entries';
const CLOSURES_TABLE = 'kaowz_closures';
const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const PLAN_CONFIG = {
  encomendadas: { label:'Facas Encomendadas' },
  producao:     { label:'Facas em Produção' },
  expedicoes:   { label:'Expedições' },
  envios:       { label:'Envios' },
  caixas:       { label:'Caixas' },
  espumas:      { label:'Espumas' },
};
const CATS = Object.keys(PLAN_CONFIG);
let PLAN = { encomendadas:[], producao:[], expedicoes:[], envios:[], caixas:[], espumas:[] };
let ALL_ENTRIES = [];   // todos os lotes, fechados ou não (fonte pros históricos)
let CLOSURES = [];      // todos os fechamentos (semana/mês/ano)
let activePlanTab = 'encomendadas';
let activePeriod = 'week'; // 'week' (ao vivo) | 'month' (histórico) | 'year' (histórico)
let charts = {};

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function fmtDate(iso){ if(!iso) return '—'; const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; }
function qty(n){ return Number(n || 0); }

function getWeekRange(){
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  const monday = new Date(now); monday.setHours(0,0,0,0); monday.setDate(now.getDate() - day);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  return [monday, sunday];
}
function getMonthRange(){
  const now = new Date();
  return [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth()+1, 0)];
}
function inRange(iso, range){
  if(!iso) return false;
  const d = new Date(iso + 'T00:00:00');
  return d >= range[0] && d <= range[1];
}
function currentRange(){ return activePeriod === 'week' ? getWeekRange() : getMonthRange(); }

async function loadData(){
  const [entriesRes, closuresRes] = await Promise.all([
    sb.from(TABLE).select('*').order('data_registro', { ascending:false }),
    sb.from(CLOSURES_TABLE).select('*').order('data_inicio', { ascending:false }),
  ]);
  if(entriesRes.error){ console.error('Erro ao carregar lançamentos:', entriesRes.error); alert('Erro ao carregar dados: ' + entriesRes.error.message); return; }
  if(closuresRes.error){ console.error('Erro ao carregar fechamentos:', closuresRes.error); alert('Erro ao carregar histórico: ' + closuresRes.error.message); return; }

  ALL_ENTRIES = entriesRes.data || [];
  CLOSURES = closuresRes.data || [];

  CATS.forEach(cat => PLAN[cat] = []);
  ALL_ENTRIES.filter(r => !r.closure_id).forEach(r => {
    if(!PLAN[r.category]) return;
    PLAN[r.category].push({
      id: r.id, data: r.data_registro, lote: r.lote,
      planejado: r.planejado, realizado: r.realizado,
      entrega: r.entrega || undefined, obs: r.obs || undefined,
    });
  });
}
function aggregateEntries(closureIds){
  const set = new Set(closureIds);
  const rows = ALL_ENTRIES.filter(r => set.has(r.closure_id));
  const planejado = rows.reduce((s,r)=>s+qty(r.planejado),0);
  const entregue = rows.reduce((s,r)=>s+qty(r.realizado),0);
  return { planejado, entregue, pendente: entregue - planejado };
}

/* ---------------- Fechamentos (Semana → Mês → Ano) ---------------- */
async function closeWeek(){
  const range = getWeekRange();
  const dataInicio = dateToISO(range[0]), dataFim = dateToISO(range[1]);
  const liveInWeek = ALL_ENTRIES.filter(r => !r.closure_id && inRange(r.data_registro, range));
  if(liveInWeek.length === 0){ alert('Não há lançamentos nesta semana para fechar.'); return; }
  if(!confirm(`Isso vai arquivar ${liveInWeek.length} lançamento(s) desta semana (${fmtDate(dataInicio)} a ${fmtDate(dataFim)}) e limpar o Planejamento ao vivo. Confirmar?`)) return;

  const monthStart = new Date(range[0].getFullYear(), range[0].getMonth(), 1);
  const monthEnd = new Date(range[0].getFullYear(), range[0].getMonth()+1, 0);
  const numero = CLOSURES.filter(c => c.tipo==='semana' && inRange(c.data_inicio, [monthStart, monthEnd])).length + 1;
  const closureId = uid();

  const { error: e1 } = await sb.from(CLOSURES_TABLE).insert({
    id: closureId, tipo:'semana', titulo:`Semana ${numero}`, numero,
    data_inicio: dataInicio, data_fim: dataFim, parent_id: null,
  });
  if(e1){ alert('Erro ao fechar semana: ' + e1.message); return; }

  const { error: e2 } = await sb.from(TABLE).update({ closure_id: closureId })
    .is('closure_id', null).gte('data_registro', dataInicio).lte('data_registro', dataFim);
  if(e2){ alert('Erro ao arquivar lançamentos: ' + e2.message); return; }

  await loadData();
  renderPeriodArea();
  renderPlanPanel();
  alert(`Semana ${numero} fechada. Veja o histórico na aba MÊS.`);
}

async function closeMonth(monthStartISO, monthEndISO, defaultTitulo){
  const monthRange = [new Date(monthStartISO+'T00:00:00'), new Date(monthEndISO+'T00:00:00')];
  const weekClosures = CLOSURES.filter(c => c.tipo==='semana' && !c.parent_id && inRange(c.data_inicio, monthRange));
  if(weekClosures.length === 0){ alert('Não há semanas fechadas para arquivar neste mês.'); return; }
  const titulo = prompt('Título para este mês:', defaultTitulo);
  if(titulo === null) return;
  const tituloFinal = titulo.trim() || defaultTitulo;
  if(!confirm(`Isso vai arquivar ${weekClosures.length} semana(s) sob o título "${tituloFinal}". Confirmar?`)) return;

  const closureId = uid();
  const { error: e1 } = await sb.from(CLOSURES_TABLE).insert({
    id: closureId, tipo:'mes', titulo: tituloFinal, numero: null,
    data_inicio: monthStartISO, data_fim: monthEndISO, parent_id: null,
  });
  if(e1){ alert('Erro ao fechar mês: ' + e1.message); return; }

  const { error: e2 } = await sb.from(CLOSURES_TABLE).update({ parent_id: closureId })
    .in('id', weekClosures.map(c => c.id));
  if(e2){ alert('Erro ao vincular semanas ao mês: ' + e2.message); return; }

  await loadData();
  renderPeriodArea();
  alert(`"${tituloFinal}" fechado. Veja o histórico na aba ANO.`);
}

async function closeYear(yearStartISO, yearEndISO, defaultTitulo){
  const yearRange = [new Date(yearStartISO+'T00:00:00'), new Date(yearEndISO+'T00:00:00')];
  const monthClosures = CLOSURES.filter(c => c.tipo==='mes' && !c.parent_id && inRange(c.data_inicio, yearRange));
  if(monthClosures.length === 0){ alert('Não há meses fechados para arquivar neste ano.'); return; }
  const titulo = prompt('Título para este ano:', defaultTitulo);
  if(titulo === null) return;
  const tituloFinal = titulo.trim() || defaultTitulo;
  if(!confirm(`Isso vai arquivar ${monthClosures.length} mês(es) sob o título "${tituloFinal}". Confirmar?`)) return;

  const closureId = uid();
  const { error: e1 } = await sb.from(CLOSURES_TABLE).insert({
    id: closureId, tipo:'ano', titulo: tituloFinal, numero: null,
    data_inicio: yearStartISO, data_fim: yearEndISO, parent_id: null,
  });
  if(e1){ alert('Erro ao fechar ano: ' + e1.message); return; }

  const { error: e2 } = await sb.from(CLOSURES_TABLE).update({ parent_id: closureId })
    .in('id', monthClosures.map(c => c.id));
  if(e2){ alert('Erro ao vincular meses ao ano: ' + e2.message); return; }

  await loadData();
  renderPeriodArea();
  alert(`"${tituloFinal}" fechado.`);
}
async function insertRow(cat, row){
  const { error } = await sb.from(TABLE).insert({
    id: row.id, category: cat, data_registro: row.data, lote: row.lote,
    planejado: qty(row.planejado), realizado: qty(row.realizado),
    entrega: row.entrega || null, obs: row.obs || null,
  });
  if(error) throw error;
}
async function updateRealizado(id, realizado){
  const { error } = await sb.from(TABLE).update({ realizado: qty(realizado) }).eq('id', id);
  if(error) throw error;
}
async function deleteRow(id){
  const { error } = await sb.from(TABLE).delete().eq('id', id);
  if(error) throw error;
}

/* ---------------- KPI (live) ---------------- */
function renderKPIs(){
  const range = currentRange();
  let totalPlan = 0, totalReal = 0;
  CATS.forEach(cat => {
    PLAN[cat].filter(r => inRange(r.data, range)).forEach(r => { totalPlan += qty(r.planejado); totalReal += qty(r.realizado); });
  });
  const pendente = totalReal - totalPlan;
  const desempenho = totalPlan > 0 ? Math.round((totalReal/totalPlan)*100) : 0;
  const label = activePeriod === 'week' ? 'Semana' : 'Mês';
  const cards = [
    { val:totalPlan, lbl:`Total Planejado — ${label}`, dim:true },
    { val:totalReal, lbl:`Total Entregue — ${label}` },
    { val:pendente, lbl:`Pendente — ${label}`, dim:true },
    { val:`${desempenho}%`, lbl:`Desempenho — ${label}` },
  ];
  document.getElementById('kpiStrip').innerHTML = cards.map(c => `
    <div class="kpi ${c.dim?'dim':''}">
      <div class="val">${c.val}</div>
      <div class="lbl">${c.lbl}</div>
    </div>`).join('');
}

/* ---------------- Gráficos em SVG (sem dependência externa) ---------------- */
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function svgBarChart(labels, series, colors, width=560, height=210){
  const pad = { top:16, right:10, bottom:34, left:8 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const maxVal = Math.max(1, ...series.flatMap(s=>s.data));
  const groupW = w / Math.max(labels.length,1);
  const barW = Math.min(28, groupW / (series.length+1.5));
  let bars = '';
  labels.forEach((lab,i) => {
    const groupX = pad.left + i*groupW + (groupW - barW*series.length)/2;
    series.forEach((s,si) => {
      const val = s.data[i] || 0;
      const barH = (val/maxVal)*h;
      const x = groupX + si*barW;
      const y = pad.top + h - barH;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW-3).toFixed(1)}" height="${Math.max(barH,0).toFixed(1)}" fill="${colors[si]}" rx="1"></rect>`;
      if(val>0) bars += `<text x="${(x+(barW-3)/2).toFixed(1)}" y="${(y-4).toFixed(1)}" font-size="9" fill="#8E8D89" text-anchor="middle" font-family="Inter,sans-serif">${val}</text>`;
    });
    bars += `<text x="${(pad.left+i*groupW+groupW/2).toFixed(1)}" y="${height-pad.bottom+16}" font-size="10" fill="#8E8D89" text-anchor="middle" font-family="Inter,sans-serif">${esc(lab)}</text>`;
  });
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;">
    <line x1="${pad.left}" y1="${pad.top+h}" x2="${width-pad.right}" y2="${pad.top+h}" stroke="#2A2B2E"></line>
    ${bars}
  </svg>`;
}

function svgDonut(labels, values, colors, size=180){
  const total = values.reduce((a,b)=>a+b,0) || 0;
  const r = size/2 - 6, cx = size/2, cy = size/2;
  let cumulative = 0, paths = '';
  if(total === 0){
    paths = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#3A3B3E"></circle>`;
  } else {
    values.forEach((v,i) => {
      if(v<=0) return;
      const frac = v/total;
      const a0 = cumulative*2*Math.PI - Math.PI/2; cumulative += frac;
      const a1 = cumulative*2*Math.PI - Math.PI/2;
      const x1=cx+r*Math.cos(a0), y1=cy+r*Math.sin(a0), x2=cx+r*Math.cos(a1), y2=cy+r*Math.sin(a1);
      const large = frac>0.5?1:0;
      paths += `<path d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${colors[i%colors.length]}"></path>`;
    });
  }
  return `<svg viewBox="0 0 ${size} ${size}" style="width:100%;height:100%;">
    ${paths}
    <circle cx="${cx}" cy="${cy}" r="${(r*0.55).toFixed(1)}" fill="#151517"></circle>
  </svg>`;
}

function legendHTML(items){
  return `<div style="display:flex;gap:14px;flex-wrap:wrap;justify-content:center;margin-top:8px;">
    ${items.map(it => `<span style="font-size:11px;color:var(--text-dim);display:flex;align-items:center;gap:5px;">
      <span style="width:9px;height:9px;background:${it.color};display:inline-block;border-radius:1px;"></span>${esc(it.label)}</span>`).join('')}
  </div>`;
}

/* ---------------- Desempenho (gerado ao Finalizar) ---------------- */
let desempenhoGenerated = false;
let activeDesempenhoTab = 'geral';

function desempenhoTabsHTML(){
  const tabs = [{ key:'geral', label:'Geral' }, ...CATS.map(c => ({ key:c, label:PLAN_CONFIG[c].label }))];
  return `<div class="entry-tabs" id="desempenhoTabs" style="margin-bottom:0;">
    ${tabs.map(t => `<button data-dtab="${t.key}" class="${activeDesempenhoTab===t.key?'active':''}">${t.label}</button>`).join('')}
  </div>`;
}

function renderDesempenho(){
  desempenhoGenerated = true;
  const area = document.getElementById('desempenhoArea');
  area.innerHTML = desempenhoTabsHTML() + `<div id="desempenhoContent" class="entry-panel"></div>`;
  document.querySelectorAll('#desempenhoTabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      activeDesempenhoTab = btn.dataset.dtab;
      document.querySelectorAll('#desempenhoTabs button').forEach(b => b.classList.toggle('active', b===btn));
      renderDesempenhoContent();
    });
  });
  renderDesempenhoContent();
}

function renderDesempenhoContent(){
  if(activeDesempenhoTab === 'geral') renderDesempenhoGeral();
  else renderDesempenhoCategoria(activeDesempenhoTab);
}

function renderDesempenhoGeral(){
  const range = currentRange();
  const rows = CATS.map(cat => {
    const filtered = PLAN[cat].filter(r => inRange(r.data, range));
    const planejado = filtered.reduce((s,r)=>s+qty(r.planejado),0);
    const entregue = filtered.reduce((s,r)=>s+qty(r.realizado),0);
    return { cat, label:PLAN_CONFIG[cat].label, planejado, entregue, pendente: entregue - planejado,
      desempenho: planejado>0 ? Math.round((entregue/planejado)*100) : 0 };
  });

  document.getElementById('desempenhoContent').innerHTML = `
    <div class="charts">
      <div class="panel">
        <h3>Planejado vs. Entregue por Categoria</h3>
        <div class="chart-box" id="chartDesempenho"></div>
        ${legendHTML([{color:'#3A3B3E',label:'Planejado'},{color:'#FF6A1A',label:'Entregue'}])}
      </div>
      <div class="panel">
        <h3>Composição do Entregue</h3>
        <div class="chart-box" id="chartComposicao"></div>
        ${legendHTML(rows.filter(r=>r.entregue>0).map((r,i)=>({color:['#FF6A1A','#C2560A','#8A3B08','#5A5B5E','#8E8D89','#3A3B3E'][i%6],label:r.label})))}
      </div>
    </div>
    <div class="panel">
      <h3>Resumo do Período</h3>
      <div class="table-scroll">
      <table class="desempenho-table">
        <thead><tr><th>Categoria</th><th>Planejado</th><th>Entregue</th><th>Pendente</th><th>Desempenho</th></tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td>${r.label}</td><td>${r.planejado}</td><td>${r.entregue}</td>
            <td class="${r.pendente<0?'pendente-neg':'pendente-pos'}">${r.pendente}</td>
            <td>${r.cat==='encomendadas' ? '—' : r.desempenho+'%'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>
    </div>`;

  document.getElementById('chartDesempenho').innerHTML = svgBarChart(
    rows.map(r=>r.label),
    [ { data: rows.map(r=>r.planejado) }, { data: rows.map(r=>r.entregue) } ],
    ['#3A3B3E', '#FF6A1A']
  );

  const nonZero = rows.filter(r=>r.entregue>0);
  document.getElementById('chartComposicao').innerHTML = svgDonut(
    nonZero.length ? nonZero.map(r=>r.label) : ['Sem dados'],
    nonZero.length ? nonZero.map(r=>r.entregue) : [1],
    ['#FF6A1A','#C2560A','#8A3B08','#5A5B5E','#8E8D89','#3A3B3E']
  );
}

function renderDesempenhoCategoria(cat){
  const range = currentRange();
  const showDesempenho = cat !== 'encomendadas';
  const isEncomendadas = cat === 'encomendadas';
  const rows = PLAN[cat].filter(r => inRange(r.data, range));
  const totalPlan = rows.reduce((s,r)=>s+qty(r.planejado),0);
  const totalReal = rows.reduce((s,r)=>s+qty(r.realizado),0);
  const totalPend = totalReal - totalPlan;
  const desempenho = totalPlan>0 ? Math.round((totalReal/totalPlan)*100) : 0;

  const cards = [
    { val:totalPlan, lbl:'Total Planejado', dim:true },
    { val:totalReal, lbl:'Total Entregue' },
    { val:totalPend, lbl:'Pendente', dim:true },
  ];
  if(showDesempenho) cards.push({ val:`${desempenho}%`, lbl:'Desempenho' });

  // Encomendadas: prazo mais distante entre TODOS os lotes registrados (não só o período)
  // e total de facas a produzir até esse prazo.
  let maxEntrega = null, totalAteLa = 0;
  if(isEncomendadas){
    const comEntrega = PLAN[cat].filter(r => r.entrega);
    if(comEntrega.length){
      maxEntrega = comEntrega.reduce((m,r) => r.entrega > m ? r.entrega : m, comEntrega[0].entrega);
      totalAteLa = comEntrega.reduce((s,r) => s + qty(r.planejado), 0);
    }
    cards.push({ val: maxEntrega ? fmtDate(maxEntrega) : '—', lbl:'Prazo Mais Distante (Último Lote)' });
    cards.push({ val: totalAteLa, lbl:'Total de Facas a Produzir até Lá' });
  }

  document.getElementById('desempenhoContent').innerHTML = `
    <div class="kpi-scroll" style="margin-bottom:20px;">
      ${cards.map(c => `<div class="kpi ${c.dim?'dim':''}"><div class="val">${c.val}</div><div class="lbl">${c.lbl}</div></div>`).join('')}
    </div>
    <div class="panel" style="margin-bottom:16px;">
      <h3>Planejado vs. Entregue por Lote — ${PLAN_CONFIG[cat].label}</h3>
      <div class="chart-box" id="chartCat"></div>
      ${legendHTML([{color:'#3A3B3E',label:'Planejado'},{color:'#FF6A1A',label:'Entregue'}])}
    </div>
    <div class="panel">
      <h3>Detalhe por Lote</h3>
      <div class="table-scroll">
      <table class="desempenho-table">
        <thead><tr><th>Lote</th>${isEncomendadas?'<th>Entrega</th>':''}<th>Planejado</th><th>Entregue</th><th>Pendente</th>${showDesempenho?'<th>Desempenho</th>':''}</tr></thead>
        <tbody>
          ${rows.length ? rows.map(r => {
            const p = qty(r.realizado) - qty(r.planejado);
            const d = qty(r.planejado)>0 ? Math.round((qty(r.realizado)/qty(r.planejado))*100) : 0;
            return `<tr><td>${r.lote}</td>${isEncomendadas?`<td>${fmtDate(r.entrega)}</td>`:''}<td>${r.planejado}</td><td>${r.realizado||0}</td>
              <td class="${p<0?'pendente-neg':'pendente-pos'}">${p}</td>${showDesempenho?`<td>${d}%</td>`:''}</tr>`;
          }).join('') : `<tr class="empty-row"><td colspan="${(showDesempenho?5:4)+(isEncomendadas?1:0)}">Sem lançamentos neste período.</td></tr>`}
        </tbody>
      </table>
      </div>
    </div>`;

  document.getElementById('chartCat').innerHTML = svgBarChart(
    rows.length ? rows.map(r=>r.lote) : ['—'],
    [ { data: rows.length ? rows.map(r=>qty(r.planejado)) : [0] }, { data: rows.length ? rows.map(r=>qty(r.realizado)) : [0] } ],
    ['#3A3B3E', '#FF6A1A']
  );
}

/* ---------------- Histórico: Mês (semanas fechadas) e Ano (meses fechados) ---------------- */
function groupOpenClosuresByMonth(){
  const groups = {};
  CLOSURES.filter(c => c.tipo==='semana' && !c.parent_id).forEach(c => {
    const d = new Date(c.data_inicio+'T00:00:00');
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if(!groups[key]) groups[key] = { key, year:d.getFullYear(), month:d.getMonth(), items:[] };
    groups[key].items.push(c);
  });
  return Object.values(groups).sort((a,b) => b.key.localeCompare(a.key));
}
function groupOpenClosuresByYear(){
  const groups = {};
  CLOSURES.filter(c => c.tipo==='mes' && !c.parent_id).forEach(c => {
    const d = new Date(c.data_inicio+'T00:00:00');
    const key = String(d.getFullYear());
    if(!groups[key]) groups[key] = { key, year:d.getFullYear(), items:[] };
    groups[key].items.push(c);
  });
  return Object.values(groups).sort((a,b) => b.key.localeCompare(a.key));
}

function renderMesArea(){
  const groups = groupOpenClosuresByMonth();
  const area = document.getElementById('desempenhoArea');
  if(groups.length === 0){
    area.innerHTML = `<div class="panel"><div class="placeholder">Nenhuma semana fechada ainda. Feche a semana atual na aba SEMANA pra começar a acumular o histórico mensal.</div></div>`;
    return;
  }
  area.innerHTML = groups.map(g => {
    const monthStart = new Date(g.year, g.month, 1), monthEnd = new Date(g.year, g.month+1, 0);
    const label = `${MESES_PT[g.month]}/${g.year}`;
    const totals = aggregateEntries(g.items.map(c=>c.id));
    const sorted = [...g.items].sort((a,b) => (a.numero||0) - (b.numero||0));
    return `
      <div class="panel" style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
          <h3 style="margin:0;">${esc(label)} <span style="font-weight:400;color:var(--text-dim);font-size:12px;">(${g.items.length} semana${g.items.length>1?'s':''} fechada${g.items.length>1?'s':''})</span></h3>
          <button class="btn-ghost" data-action="fechar-mes" data-inicio="${dateToISO(monthStart)}" data-fim="${dateToISO(monthEnd)}" data-titulo="${esc(label)}">Fechar Mês</button>
        </div>
        <div class="table-scroll">
        <table class="desempenho-table">
          <thead><tr><th>Semana</th><th>Período</th><th>Planejado</th><th>Entregue</th><th>Pendente</th></tr></thead>
          <tbody>
            ${sorted.map(c => {
              const t = aggregateEntries([c.id]);
              return `<tr><td>${esc(c.titulo)}</td><td>${fmtDate(c.data_inicio)} – ${fmtDate(c.data_fim)}</td><td>${t.planejado}</td><td>${t.entregue}</td><td class="${t.pendente<0?'pendente-neg':'pendente-pos'}">${t.pendente}</td></tr>`;
            }).join('')}
          </tbody>
          <tfoot><tr><td colspan="2">Total do mês</td><td>${totals.planejado}</td><td>${totals.entregue}</td><td class="${totals.pendente<0?'pendente-neg':'pendente-pos'}">${totals.pendente}</td></tr></tfoot>
        </table>
        </div>
      </div>`;
  }).join('');
  area.querySelectorAll('[data-action="fechar-mes"]').forEach(btn => {
    btn.addEventListener('click', () => closeMonth(btn.dataset.inicio, btn.dataset.fim, btn.dataset.titulo));
  });
}

function renderAnoArea(){
  const groups = groupOpenClosuresByYear();
  const area = document.getElementById('desempenhoArea');
  if(groups.length === 0){
    area.innerHTML = `<div class="panel"><div class="placeholder">Nenhum mês fechado ainda. Feche um mês na aba MÊS pra começar a acumular o histórico anual.</div></div>`;
    return;
  }
  area.innerHTML = groups.map(g => {
    const yearStart = new Date(g.year,0,1), yearEnd = new Date(g.year,11,31);
    const monthIds = g.items.map(c=>c.id);
    const weekIdsInYear = CLOSURES.filter(c => c.tipo==='semana' && monthIds.includes(c.parent_id)).map(c=>c.id);
    const totals = aggregateEntries(weekIdsInYear);
    const sorted = [...g.items].sort((a,b) => a.data_inicio < b.data_inicio ? 1 : -1);
    return `
      <div class="panel" style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
          <h3 style="margin:0;">${g.year} <span style="font-weight:400;color:var(--text-dim);font-size:12px;">(${g.items.length} mês${g.items.length>1?'es':''} fechado${g.items.length>1?'s':''})</span></h3>
          <button class="btn-ghost" data-action="fechar-ano" data-inicio="${dateToISO(yearStart)}" data-fim="${dateToISO(yearEnd)}" data-titulo="${g.year}">Fechar Ano</button>
        </div>
        <div class="table-scroll">
        <table class="desempenho-table">
          <thead><tr><th>Mês</th><th>Período</th><th>Planejado</th><th>Entregue</th><th>Pendente</th></tr></thead>
          <tbody>
            ${sorted.map(c => {
              const weekIds = CLOSURES.filter(w => w.tipo==='semana' && w.parent_id===c.id).map(w=>w.id);
              const t = aggregateEntries(weekIds);
              return `<tr><td>${esc(c.titulo)}</td><td>${fmtDate(c.data_inicio)} – ${fmtDate(c.data_fim)}</td><td>${t.planejado}</td><td>${t.entregue}</td><td class="${t.pendente<0?'pendente-neg':'pendente-pos'}">${t.pendente}</td></tr>`;
            }).join('')}
          </tbody>
          <tfoot><tr><td colspan="2">Total do ano</td><td>${totals.planejado}</td><td>${totals.entregue}</td><td class="${totals.pendente<0?'pendente-neg':'pendente-pos'}">${totals.pendente}</td></tr></tfoot>
        </table>
        </div>
      </div>`;
  }).join('');
  area.querySelectorAll('[data-action="fechar-ano"]').forEach(btn => {
    btn.addEventListener('click', () => closeYear(btn.dataset.inicio, btn.dataset.fim, btn.dataset.titulo));
  });
}

/* ---------------- Planejamento (Lote + Planejado/Entregue, igual pra todas) ---------------- */
function renderPlanPanel(){
  document.getElementById('planPanel').innerHTML = planTemplate(activePlanTab);
  attachPlanHandlers();
}
function planTemplate(cat){
  const rows = [...PLAN[cat]].sort((a,b)=>(b.data||'').localeCompare(a.data||''));
  const totalPlan = rows.reduce((s,r)=>s+qty(r.planejado),0);
  const totalReal = rows.reduce((s,r)=>s+qty(r.realizado),0);
  const totalPend = totalReal - totalPlan;
  const isEncomendadas = cat === 'encomendadas';
  const isProducao = cat === 'producao';
  const extraCols = (isEncomendadas?1:0) + (isProducao?1:0);
  return `
  <form class="entry-form" id="formPlan">
    <div class="field"><label>Data</label><input type="date" name="data" value="${todayISO()}" required></div>
    <div class="field"><label>Lote</label><input type="text" name="lote" placeholder="Ex: L63" required></div>
    ${isEncomendadas ? `<div class="field"><label>Data de Entrega</label><input type="date" name="entrega"></div>` : ''}
    ${isProducao ? `<div class="field"><label>Observação</label><input type="text" name="obs" placeholder="Opcional" style="min-width:200px;"></div>` : ''}
    <div class="field"><label>Qtd. Planejada</label><input type="number" name="planejado" min="0" value="1" required></div>
    <button class="btn" type="submit">Registrar</button>
  </form>
  <div class="table-scroll">
  <table class="plan-table">
    <thead><tr><th>Data</th><th>Lote</th>${isEncomendadas?'<th>Entrega</th>':''}${isProducao?'<th>Observação</th>':''}<th>Qtd. Planejada</th><th>Qtd. Entregue</th><th>Pendente</th><th></th></tr></thead>
    <tbody>
      ${rows.length ? rows.map(r => {
        const pend = qty(r.realizado) - qty(r.planejado);
        return `<tr><td>${fmtDate(r.data)}</td><td>${r.lote}</td>
          ${isEncomendadas?`<td>${fmtDate(r.entrega)}</td>`:''}
          ${isProducao?`<td>${r.obs ? esc(r.obs) : '—'}</td>`:''}
          <td>${r.planejado}</td>
          <td><input type="number" class="qty-input" min="0" value="${r.realizado||0}" data-id="${r.id}"></td>
          <td class="${pend<0?'pendente-neg':'pendente-pos'}">${pend}</td>
          <td><button class="btn-ghost" data-action="del-plan" data-id="${r.id}">Excluir</button></td></tr>`;
      }).join('') : `<tr class="empty-row"><td colspan="${6+extraCols}">Nenhuma linha registrada ainda.</td></tr>`}
    </tbody>
    ${rows.length ? `<tfoot><tr><td colspan="${2+extraCols}"></td><td>${totalPlan}</td><td>${totalReal}</td><td class="${totalPend<0?'pendente-neg':'pendente-pos'}">${totalPend}</td><td></td></tr></tfoot>` : ''}
  </table>
  </div>`;
}
function attachPlanHandlers(){
  const form = document.getElementById('formPlan');
  if(form) form.addEventListener('submit', async e => {
    e.preventDefault();
    try{
      const fd = new FormData(form);
      const row = { id:uid(), data:fd.get('data'), lote:fd.get('lote'), planejado:fd.get('planejado'), realizado:0 };
      if(activePlanTab === 'encomendadas') row.entrega = fd.get('entrega') || '';
      if(activePlanTab === 'producao') row.obs = fd.get('obs') || '';
      await insertRow(activePlanTab, row);
      PLAN[activePlanTab].push(row);
      ALL_ENTRIES.push({
        id: row.id, category: activePlanTab, data_registro: row.data, lote: row.lote,
        planejado: qty(row.planejado), realizado: 0,
        entrega: row.entrega || null, obs: row.obs || null, closure_id: null,
      });
      renderPlanPanel(); renderKPIs();
    }catch(err){
      console.error('Erro ao registrar:', err);
      alert('Erro ao registrar: ' + err.message);
    }
  });
  document.querySelectorAll('#planPanel input.qty-input').forEach(inp => {
    inp.addEventListener('change', async () => {
      try{
        const row = PLAN[activePlanTab].find(r => r.id === inp.dataset.id);
        if(row){
          await updateRealizado(row.id, inp.value);
          row.realizado = inp.value;
          const raw = ALL_ENTRIES.find(r => r.id === row.id);
          if(raw) raw.realizado = qty(inp.value);
          renderPlanPanel(); renderKPIs();
        }
      }catch(err){
        console.error('Erro ao atualizar quantidade:', err);
        alert('Erro ao atualizar quantidade: ' + err.message);
      }
    });
  });
  document.querySelectorAll('#planPanel [data-action="del-plan"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try{
        await deleteRow(btn.dataset.id);
        PLAN[activePlanTab] = PLAN[activePlanTab].filter(r => r.id !== btn.dataset.id);
        ALL_ENTRIES = ALL_ENTRIES.filter(r => r.id !== btn.dataset.id);
        renderPlanPanel(); renderKPIs();
      }catch(err){
        console.error('Erro ao excluir:', err);
        alert('Erro ao excluir: ' + err.message);
      }
    });
  });
}

document.getElementById('finalizarBtn').addEventListener('click', renderDesempenho);
document.getElementById('fecharSemanaBtn').addEventListener('click', closeWeek);

function renderPeriodArea(){
  const weekOnlyIds = ['finalizarBtn','relatorioBtn','fecharSemanaBtn'];
  weekOnlyIds.forEach(id => { document.getElementById(id).style.display = activePeriod==='week' ? '' : 'none'; });

  const sub = document.getElementById('desempenhoSub');
  if(activePeriod==='week'){
    document.getElementById('kpiStrip').style.display = '';
    sub.textContent = '— gerado ao clicar em Finalizar Métricas';
    renderKPIs();
    desempenhoGenerated = false;
    document.getElementById('desempenhoArea').innerHTML = `<div class="panel"><div class="placeholder">Preencha o planejamento abaixo e clique em "Finalizar Métricas" para gerar os gráficos e o desempenho da semana.</div></div>`;
  } else if(activePeriod==='month'){
    document.getElementById('kpiStrip').style.display = 'none';
    sub.textContent = '— histórico de semanas fechadas';
    renderMesArea();
  } else {
    document.getElementById('kpiStrip').style.display = 'none';
    sub.textContent = '— histórico de meses fechados';
    renderAnoArea();
  }
}

document.getElementById('periodToggle').addEventListener('click', e => {
  const btn = e.target.closest('button[data-period]'); if(!btn) return;
  activePeriod = btn.dataset.period;
  document.querySelectorAll('#periodToggle button').forEach(b => b.classList.toggle('active', b === btn));
  renderPeriodArea();
});
document.getElementById('planTabs').addEventListener('click', e => {
  const btn = e.target.closest('button[data-plan]'); if(!btn) return;
  activePlanTab = btn.dataset.plan;
  document.querySelectorAll('#planTabs button').forEach(b => b.classList.toggle('active', b === btn));
  renderPlanPanel();
});

/* ---------------- Relatório (impressão / PDF) ---------------- */
function dateToISO(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function periodLabel(range){
  if(activePeriod === 'week'){
    return `Semana de ${fmtDate(dateToISO(range[0]))} a ${fmtDate(dateToISO(range[1]))}`;
  }
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  return `Mês de ${meses[range[0].getMonth()]}/${range[0].getFullYear()}`;
}
function gerarRelatorio(){
  const range = currentRange();
  const geradoEm = fmtDate(todayISO()) + ' ' + new Date().toTimeString().slice(0,5);

  const resumo = CATS.map(cat => {
    const rows = PLAN[cat].filter(r => inRange(r.data, range));
    const planejado = rows.reduce((s,r)=>s+qty(r.planejado),0);
    const entregue = rows.reduce((s,r)=>s+qty(r.realizado),0);
    const desempenho = planejado>0 ? Math.round((entregue/planejado)*100) : 0;
    return { cat, label:PLAN_CONFIG[cat].label, planejado, entregue, pendente: entregue - planejado, desempenho };
  });
  const nonZero = resumo.filter(r=>r.entregue>0);

  let html = `
    <div class="relatorio-title">KAOWZ — Relatório de Operação</div>
    <div class="relatorio-sub">${esc(periodLabel(range))} · Gerado em ${geradoEm}</div>
    <div class="relatorio-section">
      <h3>Planejado vs. Entregue por Categoria</h3>
      <div class="relatorio-chart">${svgBarChart(resumo.map(r=>r.label), [{data:resumo.map(r=>r.planejado)},{data:resumo.map(r=>r.entregue)}], ['#3A3B3E','#FF6A1A'])}</div>
      ${legendHTML([{color:'#3A3B3E',label:'Planejado'},{color:'#FF6A1A',label:'Entregue'}])}
    </div>
    <div class="relatorio-section">
      <h3>Composição do Entregue</h3>
      <div class="relatorio-chart relatorio-chart-sm">${svgDonut(nonZero.length?nonZero.map(r=>r.label):['Sem dados'], nonZero.length?nonZero.map(r=>r.entregue):[1], ['#FF6A1A','#C2560A','#8A3B08','#5A5B5E','#8E8D89','#3A3B3E'])}</div>
      ${legendHTML(nonZero.map((r,i)=>({color:['#FF6A1A','#C2560A','#8A3B08','#5A5B5E','#8E8D89','#3A3B3E'][i%6],label:r.label})))}
    </div>
    <div class="relatorio-section">
      <h3>Resumo Geral</h3>
      <table class="relatorio-table">
        <thead><tr><th>Categoria</th><th>Planejado</th><th>Entregue</th><th>Pendente</th><th>Desempenho</th></tr></thead>
        <tbody>
          ${resumo.map(r => `<tr><td>${esc(r.label)}</td><td>${r.planejado}</td><td>${r.entregue}</td><td>${r.pendente}</td><td>${r.cat==='encomendadas'?'—':r.desempenho+'%'}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  CATS.forEach(cat => {
    const isEnc = cat === 'encomendadas';
    const isProd = cat === 'producao';
    const rows = PLAN[cat].filter(r => inRange(r.data, range)).sort((a,b)=>(b.data||'').localeCompare(a.data||''));
    const cols = 5 + (isEnc?1:0) + (isProd?1:0);
    html += `
      <div class="relatorio-section">
        <h3>Detalhe — ${esc(PLAN_CONFIG[cat].label)}</h3>
        <table class="relatorio-table">
          <thead><tr><th>Data</th><th>Lote</th>${isEnc?'<th>Entrega</th>':''}${isProd?'<th>Observação</th>':''}<th>Planejado</th><th>Entregue</th><th>Pendente</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map(r => {
              const p = qty(r.realizado) - qty(r.planejado);
              return `<tr><td>${fmtDate(r.data)}</td><td>${esc(r.lote)}</td>${isEnc?`<td>${fmtDate(r.entrega)}</td>`:''}${isProd?`<td>${r.obs?esc(r.obs):'—'}</td>`:''}<td>${r.planejado}</td><td>${r.realizado||0}</td><td>${p}</td></tr>`;
            }).join('') : `<tr><td colspan="${cols}">Sem lançamentos neste período.</td></tr>`}
          </tbody>
        </table>
      </div>`;
  });

  document.getElementById('relatorioArea').innerHTML = html;
  window.print();
}
document.getElementById('relatorioBtn').addEventListener('click', gerarRelatorio);

(async function init(){
  document.getElementById('kpiStrip').innerHTML = `<div style="color:var(--text-dim);padding:20px 4px;">Carregando dados…</div>`;
  await loadData();
  renderPeriodArea();
  renderPlanPanel();
})();
