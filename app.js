const cfg=window.SUPABASE_CONFIG||{};const db=supabase.createClient(cfg.url,cfg.anonKey);
let state={month:null,participants:[],payments:[],products:[],stock:[],purchases:[],nfs:[]};
const $=id=>document.getElementById(id), money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const toast=(m)=>{const e=$('toast');e.textContent=m;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2400)};
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function monthStart(){const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1).toISOString().slice(0,10)}
function monthBR(s){return new Date(s+'T12:00:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}
async function ensureMonth(){
  const m=monthStart();
  let {data:c,error}=await db.from('competencias').select('*').eq('competencia',m).maybeSingle(); if(error) throw error;
  if(!c){let r=await db.from('competencias').insert({competencia:m,valor_padrao:50}).select().single();if(r.error)throw r.error;c=r.data}
  state.month=c;
  let [p,pr]=await Promise.all([
    db.from('participantes').select('*').order('nome'),
    db.from('produtos_padrao').select('*').eq('ativo',true).order('nome')
  ]);
  if(p.error)throw p.error;if(pr.error)throw pr.error; state.participants=p.data||[];state.products=pr.data||[];
  let pay=await db.from('pagamentos_secao').select('*').eq('competencia_id',c.id);if(pay.error)throw pay.error;state.payments=pay.data||[];
  let st=await db.from('estoque_secao').select('*').eq('competencia_id',c.id);if(st.error)throw st.error;state.stock=st.data||[];
  if(state.participants.length && state.payments.length<state.participants.length){
    const existing=new Set(state.payments.map(x=>x.participante_id));
    const rows=state.participants.filter(x=>!existing.has(x.id)).map(x=>({competencia_id:c.id,participante_id:x.id,valor:c.valor_padrao,pago:false}));
    if(rows.length){await db.from('pagamentos_secao').insert(rows);let r=await db.from('pagamentos_secao').select('*').eq('competencia_id',c.id);state.payments=r.data||[]}
  }
  if(state.products.length && state.stock.length<state.products.length){
    const existing=new Set(state.stock.map(x=>x.produto_id));
    const rows=state.products.filter(x=>!existing.has(x.id)).map(x=>({competencia_id:c.id,produto_id:x.id,estoque_inicial:x.estoque_atual||0,estoque_desejado:x.estoque_desejado||x.quantidade_padrao||0}));
    if(rows.length){await db.from('estoque_secao').insert(rows);let r=await db.from('estoque_secao').select('*').eq('competencia_id',c.id);state.stock=r.data||[]}
  }
  let pu=await db.from('compras_secao').select('*').eq('competencia_id',c.id).order('criado_em');if(pu.error)throw pu.error;state.purchases=pu.data||[];
  let nf=await db.from('notas_fiscais_secao').select('*').eq('competencia_id',c.id).order('data_nf',{ascending:false});if(nf.error)throw nf.error;state.nfs=nf.data||[];
}
async function load(){try{await ensureMonth();renderAll()}catch(e){console.error(e);toast('Erro ao carregar dados: '+(e.message||e))}}
function renderAll(){
  $('monthTitle').textContent=monthBR(state.month.competencia);$('monthLabel').textContent=monthBR(state.month.competencia);
  const paid=state.payments.filter(x=>x.pago).reduce((s,x)=>s+Number(x.valor||0),0), spent=state.purchases.reduce((s,x)=>s+Number(x.quantidade||0)*Number(x.valor_unitario||0),0);
  $('sumPaid').textContent=money(paid);$('sumSpent').textContent=money(spent);$('sumBalance').textContent=money(paid-spent);$('sumPending').textContent=state.payments.filter(x=>!x.pago).length;
  renderPayments();renderStock();renderPurchases();renderNfs();renderReport();
}
function renderPayments(){
  const el=$('paymentsList'); if(!state.payments.length){el.innerHTML='<div class="empty">Nenhum pagamento cadastrado.</div>';return}
  el.innerHTML=state.payments.map(p=>{const person=state.participants.find(x=>x.id===p.participante_id);return `<div class="row"><div><div class="row-title">${esc(person?.nome||'Participante')}</div><div class="muted">${p.pago?'Pago'+(p.pago_em?' em '+new Date(p.pago_em).toLocaleDateString('pt-BR'):''):'Pendente'}</div></div><div class="row-actions"><span class="money">${money(p.valor)}</span><span class="badge ${p.pago?'ok':'warn'}">${p.pago?'PAGO':'PENDENTE'}</span><button class="ghost" data-pay="${p.id}">${p.pago?'Desmarcar':'Marcar pago'}</button>${person?`<button class="ghost" data-edit="${person.id}">Editar</button>`:''}</div></div>`}).join('');
  el.querySelectorAll('[data-pay]').forEach(b=>b.onclick=async()=>{const id=b.dataset.pay,p=state.payments.find(x=>x.id===id);let r=await db.from('pagamentos_secao').update({pago:!p.pago,pago_em:!p.pago?new Date().toISOString():null}).eq('id',id);if(r.error)toast(r.error.message);else load()});
  el.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openParticipant(b.dataset.edit));
}
function renderStock(){
 const el=$('stockList');if(!state.stock.length){el.innerHTML='<div class="empty">Nenhum produto ativo.</div>';return}
 el.innerHTML=state.stock.map(s=>{const p=state.products.find(x=>x.id===s.produto_id);return `<div class="row"><div class="product-cell"><div class="row-title">${esc(p?.nome||'Produto')}</div><div class="muted">A comprar: <b>${Number(s.quantidade_a_comprar||0)}</b> ${esc(p?.unidade||'un')}</div></div><div class="row-actions"><label class="inline">Atual <input class="stock-in" data-id="${s.id}" value="${s.estoque_inicial}" type="number" min="0" step="0.01"></label><label class="inline">Desejado <input class="stock-des" data-id="${s.id}" value="${s.estoque_desejado}" type="number" min="0" step="0.01"></label><button class="ghost" data-stock="${s.id}">Salvar</button></div></div>`}).join('');
 el.querySelectorAll('[data-stock]').forEach(b=>b.onclick=async()=>{const id=b.dataset.stock;const a=el.querySelector(`.stock-in[data-id="${id}"]`).value,d=el.querySelector(`.stock-des[data-id="${id}"]`).value;let r=await db.from('estoque_secao').update({estoque_inicial:Number(a)||0,estoque_desejado:Number(d)||0,atualizado_em:new Date().toISOString()}).eq('id',id);if(r.error)toast(r.error.message);else load()})
}
function renderPurchases(){
 const el=$('purchaseList');el.innerHTML=state.purchases.length?state.purchases.map(x=>`<div class="row"><div><div class="row-title">${esc(x.produto)}</div><div class="muted">${x.quantidade} × ${money(x.valor_unitario)} ${x.observacao?'· '+esc(x.observacao):''}</div></div><div class="row-actions"><span class="money">${money(Number(x.quantidade)*Number(x.valor_unitario))}</span><button class="ghost" data-pe="${x.id}">Editar</button><button class="ghost" data-pd="${x.id}">Excluir</button></div></div>`).join(''):'<div class="empty">Nenhuma compra registrada.</div>';
 $('purchaseTotal').textContent=money(state.purchases.reduce((s,x)=>s+Number(x.quantidade)*Number(x.valor_unitario),0));
 el.querySelectorAll('[data-pe]').forEach(b=>b.onclick=()=>openPurchase(b.dataset.pe));el.querySelectorAll('[data-pd]').forEach(b=>b.onclick=async()=>{if(confirm('Excluir este item?')){let r=await db.from('compras_secao').delete().eq('id',b.dataset.pd);if(r.error)toast(r.error.message);else load()}})
}
function renderNfs(){
 const el=$('nfList');el.innerHTML=state.nfs.length?state.nfs.map(x=>`<div class="row"><div><div class="row-title">NF ${esc(x.numero_nf||'—')} · ${esc(x.fornecedor||'Fornecedor não informado')}</div><div class="muted">${x.data_nf?new Date(x.data_nf+'T12:00:00').toLocaleDateString('pt-BR'):''}${x.observacao?' · '+esc(x.observacao):''}</div></div><div class="row-actions"><span class="money">${money(x.valor)}</span><button class="ghost" data-ne="${x.id}">Editar</button><button class="ghost" data-nd="${x.id}">Excluir</button></div></div>`).join(''):'<div class="empty">Nenhuma NF registrada.</div>';
 el.querySelectorAll('[data-ne]').forEach(b=>b.onclick=()=>openNf(b.dataset.ne));el.querySelectorAll('[data-nd]').forEach(b=>b.onclick=async()=>{if(confirm('Excluir esta NF?')){let r=await db.from('notas_fiscais_secao').delete().eq('id',b.dataset.nd);if(r.error)toast(r.error.message);else load()}})
}
function renderReport(){
 const paid=state.payments.filter(x=>x.pago).reduce((s,x)=>s+Number(x.valor||0),0),pending=state.payments.filter(x=>!x.pago),spent=state.purchases.reduce((s,x)=>s+Number(x.quantidade)*Number(x.valor_unitario),0);
 let t=`🛒 COMPRAS DA SEÇÃO\n📅 ${monthBR(state.month.competencia)}\n\n💰 ARRECADAÇÃO\nPago: ${money(paid)}\nPendentes: ${pending.length}\n${pending.length?pending.map(x=>'• '+(state.participants.find(p=>p.id===x.participante_id)?.nome||'Participante')).join('\\n'):'Todos pagos'}\n\n🛍️ COMPRAS\nTotal: ${money(spent)}\n${state.purchases.map(x=>'• '+x.produto+' — '+x.quantidade+' × '+money(x.valor_unitario)+' = '+money(Number(x.quantidade)*Number(x.valor_unitario))).join('\\n')||'Nenhuma compra registrada.'}\n\n📊 SALDO: ${money(paid-spent)}\n\n🧾 NFs: ${state.nfs.length}`;
 $('reportText').textContent=t;
}
function openParticipant(id){const p=state.participants.find(x=>x.id===id);$('participantId').value=p?.id||'';$('participantName').value=p?.nome||'';$('participantActive').checked=p?.ativo??true;$('participantDialogTitle').textContent=p?'Editar participante':'Novo participante';$('participantDialog').showModal()}
async function saveParticipant(e){e.preventDefault();const id=$('participantId').value,name=$('participantName').value.trim(),ativo=$('participantActive').checked;if(!name)return;if(id){await db.from('participantes').update({nome,ativo}).eq('id',id)}else{const r=await db.from('participantes').insert({nome,ativo}).select().single();if(r.error){toast(r.error.message);return}await db.from('pagamentos_secao').insert({competencia_id:state.month.id,participante_id:r.data.id,valor:state.month.valor_padrao,pago:false})}$('participantDialog').close();load()}
function openPurchase(id){const x=state.purchases.find(p=>p.id===id);$('purchaseId').value=x?.id||'';$('purchaseProduct').innerHTML='<option value="">Manual</option>'+state.products.map(p=>`<option value="${p.id}">${esc(p.nome)}</option>`).join('');$('purchaseProduct').value=x?.produto_id||'';$('purchaseName').value=x?.produto||'';$('purchaseQty').value=x?.quantidade??1;$('purchaseUnit').value=x?.valor_unitario??0;$('purchaseObs').value=x?.observacao||'';$('purchaseDialog').showModal()}
async function savePurchase(e){e.preventDefault();const id=$('purchaseId').value,produto_id=$('purchaseProduct').value||null,produto=$('purchaseName').value.trim(),quantidade=Number($('purchaseQty').value)||0,valor_unitario=Number($('purchaseUnit').value)||0,observacao=$('purchaseObs').value.trim();if(!produto)return;const obj={competencia_id:state.month.id,produto_id,produto,quantidade,valor_unitario,observacao};let r=id?await db.from('compras_secao').update(obj).eq('id',id):await db.from('compras_secao').insert(obj);if(r.error)toast(r.error.message);else{$('purchaseDialog').close();load()}}
function openNf(id){const x=state.nfs.find(n=>n.id===id);$('nfId').value=x?.id||'';$('nfNumber').value=x?.numero_nf||'';$('nfSupplier').value=x?.fornecedor||'';$('nfDate').value=x?.data_nf||new Date().toISOString().slice(0,10);$('nfValue').value=x?.valor??0;$('nfObs').value=x?.observacao||'';$('nfDialog').showModal()}
async function saveNf(e){e.preventDefault();const id=$('nfId').value,obj={competencia_id:state.month.id,numero_nf:$('nfNumber').value.trim(),fornecedor:$('nfSupplier').value.trim(),data_nf:$('nfDate').value||null,valor:Number($('nfValue').value)||0,observacao:$('nfObs').value.trim()};let r=id?await db.from('notas_fiscais_secao').update(obj).eq('id',id):await db.from('notas_fiscais_secao').insert(obj);if(r.error)toast(r.error.message);else{$('nfDialog').close();load()}}
async function generatePurchases(){let added=0;for(const s of state.stock){const qty=Number(s.quantidade_a_comprar||0);if(qty<=0)continue;const p=state.products.find(x=>x.id===s.produto_id);if(!p)continue;const already=state.purchases.find(x=>x.produto_id===p.id);if(already)continue;const r=await db.from('compras_secao').insert({competencia_id:state.month.id,produto_id:p.id,produto:p.nome,quantidade:qty,valor_unitario:0});if(!r.error)added++}toast(added?`${added} item(ns) adicionados à lista.`:'Nenhum novo item para adicionar.');load()}
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.tab-panel').forEach(x=>x.hidden=true);b.classList.add('active');$('tab-'+b.dataset.tab).hidden=false});
$('loginForm').onsubmit=async e=>{e.preventDefault();$('loginMsg').textContent='Entrando...';const r=await db.auth.signInWithPassword({email:$('email').value,password:$('password').value});if(r.error){$('loginMsg').textContent=r.error.message}else{await showApp()}};
$('logoutBtn').onclick=async()=>{await db.auth.signOut();$('appView').hidden=true;$('loginView').hidden=false};
$('refreshBtn').onclick=load;$('newParticipantBtn').onclick=()=>openParticipant();$('participantForm').onsubmit=saveParticipant;$('newPurchaseBtn').onclick=()=>openPurchase();$('purchaseForm').onsubmit=savePurchase;$('newNfBtn').onclick=()=>openNf();$('nfForm').onsubmit=saveNf;$('generatePurchasesBtn').onclick=generatePurchases;
$('copyReportBtn').onclick=async()=>{await navigator.clipboard.writeText($('reportText').textContent);toast('Relatório copiado.')};
$('whatsappBtn').onclick=()=>window.open('https://wa.me/?text='+encodeURIComponent($('reportText').textContent),'_blank');
$('defaultAmount').onchange=async()=>{const v=Number($('defaultAmount').value)||0;await db.from('competencias').update({valor_padrao:v}).eq('id',state.month.id);await db.from('pagamentos_secao').update({valor:v}).eq('competencia_id',state.month.id).eq('pago',false);load()};
async function showApp(){$('loginView').hidden=true;$('appView').hidden=false;await load()}
(async()=>{if(!cfg.anonKey||cfg.anonKey.includes('COLE_AQUI')){console.warn('Configure config.js com a chave anon/public do Supabase.')}const s=await db.auth.getSession();if(s.data.session)await showApp()})();
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(console.error);