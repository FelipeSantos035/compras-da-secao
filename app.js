(async()=>{try{if('serviceWorker' in navigator){const regs=await navigator.serviceWorker.getRegistrations();if(regs.length){await Promise.all(regs.map(x=>x.unregister()));}}}catch(e){console.warn('SW cleanup',e)}})();
const cfg=window.SUPABASE_CONFIG||{};const db=supabase.createClient(cfg.url,cfg.anonKey);
let state={month:null,participants:[],payments:[],products:[],stock:[],purchases:[],nfs:[]};
const participantOrder=[
  'Cap Pelegrini','Cap Jerônimo','Ten Clarice','Sub Gilson',
  'Sgt Nilson','Sgt Vilela','Sgt Bragato','Sgt Bonafe','Sgt Roberta','Sgt Fabiana',
  'Cb Danylo','Cb Venturela','Cb Panini','Cb Bezerra','Cb Locatelli','Cb Batista','Cb Melo',
  'Sd Carlos','Sd Felipe','Sd Coimbra','Sd Leticia','Sd Correia'
];
const participantAliases={'Sd Fabiana':'Sgt Fabiana'};
const productOrder=[
  'Açúcar','Biscoito de coco rosquinha','Biscoito Marilan','Biscoito wafer',
  'Bolo','Café','Cream Cracker','Filtro','Leite','Manteiga','Margarina','Pão de forma'
];
function sortProducts(list){
  return [...list].sort((a,b)=>{
    const ia=productOrder.indexOf(a.nome),ib=productOrder.indexOf(b.nome);
    return (ia===-1?999:ia)-(ib===-1?999:ib) || String(a.nome).localeCompare(String(b.nome),'pt-BR');
  });
}
const rankOrder=['Cap','Ten','Sub','Sgt','Cb','Sd'];
function sortParticipants(list){
  return [...list].sort((a,b)=>{
    const ia=participantOrder.indexOf(participantAliases[a.nome]||a.nome), ib=participantOrder.indexOf(participantAliases[b.nome]||b.nome);
    if(ia!==-1 || ib!==-1) return (ia===-1?999:ia)-(ib===-1?999:ib);
    const ra=rankOrder.findIndex(r=>a.nome?.startsWith(r+' ')), rb=rankOrder.findIndex(r=>b.nome?.startsWith(r+' '));
    return (ra===-1?999:ra)-(rb===-1?999:rb) || String(a.nome).localeCompare(String(b.nome),'pt-BR');
  });
}
const $=id=>document.getElementById(id), money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const toast=(m)=>{const e=$('toast');e.textContent=m;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2400)};
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function monthStart(){
  const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1).toISOString().slice(0,10)
}
function shiftMonth(iso,delta){
  const d=new Date(iso+'T12:00:00');d.setMonth(d.getMonth()+delta);return new Date(d.getFullYear(),d.getMonth(),1).toISOString().slice(0,10)
}
function monthBR(s){return new Date(s+'T12:00:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}
function selectedMonth(){return state.month?.competencia||monthStart()}
async function syncStockFinal(){
  if(!state.month||!state.stock.length)return;
  for(const s of state.stock){
    const bought=state.purchases.filter(x=>x.produto_id===s.produto_id).reduce((sum,x)=>sum+Number(x.quantidade||0),0);
    const final=Number(s.estoque_inicial||0)+bought;
    if(Number(s.quantidade_comprada||0)!==bought || Number(s.estoque_final||0)!==final){
      await db.from('estoque_secao').update({quantidade_comprada:bought,estoque_final:final}).eq('id',s.id);
      s.quantidade_comprada=bought;s.estoque_final=final;
    }
  }
}
async function ensureMonth(m=monthStart()){
  let {data:c,error}=await db.from('competencias').select('*').eq('competencia',m).maybeSingle();if(error)throw error;
  let created=false;
  if(!c){
    let r=await db.from('competencias').insert({competencia:m,valor_padrao:50}).select().single();
    if(r.error)throw r.error;c=r.data;created=true;
  }
  state.month=c;
  let [p,pr]=await Promise.all([
    db.from('participantes').select('*').order('nome'),
    db.from('produtos_padrao').select('*').eq('ativo',true).order('nome')
  ]);
  if(p.error)throw p.error;if(pr.error)throw pr.error;
  state.participants=sortParticipants(p.data||[]);state.products=sortProducts(pr.data||[]);
  let pay=await db.from('pagamentos_secao').select('*').eq('competencia_id',c.id);if(pay.error)throw pay.error;state.payments=pay.data||[];
  let st=await db.from('estoque_secao').select('*').eq('competencia_id',c.id);if(st.error)throw st.error;state.stock=st.data||[];

  if(state.participants.length && state.payments.length<state.participants.length){
    const existing=new Set(state.payments.map(x=>x.participante_id));
    const rows=state.participants.filter(x=>!existing.has(x.id)).map(x=>({competencia_id:c.id,participante_id:x.id,valor:c.valor_padrao,pago:false}));
    if(rows.length){
      const ir=await db.from('pagamentos_secao').insert(rows);if(ir.error)throw ir.error;
      let r=await db.from('pagamentos_secao').select('*').eq('competencia_id',c.id);if(r.error)throw r.error;state.payments=r.data||[];
    }
  }

  if(state.products.length && state.stock.length<state.products.length){
    const existing=new Set(state.stock.map(x=>x.produto_id));
    let previous=[];
    if(created){
      const prevId=shiftMonth(m,-1);
      const pc=await db.from('competencias').select('id').eq('competencia',prevId).maybeSingle();
      if(pc.error)throw pc.error;
      if(pc.data){
        const ps=await db.from('estoque_secao').select('*').eq('competencia_id',pc.data.id);
        if(ps.error)throw ps.error;previous=ps.data||[];
      }
    }
    const rows=state.products.filter(x=>!existing.has(x.id)).map(x=>{
      const prev=previous.find(y=>y.produto_id===x.id);
      const initial=prev?Number(prev.estoque_final ?? prev.estoque_inicial ?? 0):Number(x.estoque_atual||0);
      const desired=prev?Number(prev.estoque_desejado||0):Number(x.estoque_desejado||x.quantidade_padrao||0);
      return {competencia_id:c.id,produto_id:x.id,estoque_inicial:initial,estoque_desejado:desired,quantidade_comprada:0,estoque_final:initial};
    });
    if(rows.length){
      const ir=await db.from('estoque_secao').insert(rows);if(ir.error)throw ir.error;
      let r=await db.from('estoque_secao').select('*').eq('competencia_id',c.id);if(r.error)throw r.error;state.stock=r.data||[];
    }
  }
  let pu=await db.from('compras_secao').select('*').eq('competencia_id',c.id).order('criado_em');if(pu.error)throw pu.error;state.purchases=pu.data||[];
  let nf=await db.from('notas_fiscais_secao').select('*').eq('competencia_id',c.id).order('data_nf',{ascending:false});if(nf.error)throw nf.error;state.nfs=nf.data||[];
  await syncStockFinal();
}
async function load(m=selectedMonth()){
  try{await ensureMonth(m);renderAll()}catch(e){console.error(e);toast('Erro ao carregar dados: '+(e.message||e))}
}
async function changeMonth(delta){
  const target=shiftMonth(selectedMonth(),delta);
  await load(target);
}
function renderAll(){
  $('monthTitle').textContent=monthBR(state.month.competencia);
  $('monthLabel').textContent=monthBR(state.month.competencia);
  const paid=state.payments.filter(x=>x.pago).reduce((s,x)=>s+Number(x.valor||0),0);
  const spent=state.purchases.reduce((s,x)=>s+Number(x.quantidade||0)*Number(x.valor_unitario||0),0);
  $('sumPaid').textContent=money(paid);
  $('sumSpent').textContent=money(spent);
  $('sumBalance').textContent=money(paid-spent);
  $('sumPending').textContent=state.payments.filter(x=>!x.pago).length;
  renderPayments();renderStock();renderPurchases();renderNfs();renderReport();
}
function renderPayments(){
  const el=$('paymentsList'); if(!state.payments.length){el.innerHTML='<div class="empty">Nenhum pagamento cadastrado.</div>';return}
  const orderedPayments=[...state.payments].sort((a,b)=>{
    const pa=state.participants.find(x=>x.id===a.participante_id);
    const pb=state.participants.find(x=>x.id===b.participante_id);
    const ia=participantOrder.indexOf(participantAliases[pa?.nome]||pa?.nome);
    const ib=participantOrder.indexOf(participantAliases[pb?.nome]||pb?.nome);
    return (ia===-1?999:ia)-(ib===-1?999:ib);
  });
  el.innerHTML=orderedPayments.map(p=>{const person=state.participants.find(x=>x.id===p.participante_id);return `<div class="row"><div><div class="row-title">${esc(person?.nome||'Participante')}</div><div class="muted">${p.pago?'Pago'+(p.pago_em?' em '+new Date(p.pago_em).toLocaleDateString('pt-BR'):''):'Pendente'}</div></div><div class="row-actions"><span class="money">${money(p.valor)}</span><span class="badge ${p.pago?'ok':'warn'}">${p.pago?'PAGO':'PENDENTE'}</span><button class="ghost" data-pay="${p.id}">${p.pago?'Desmarcar':'Marcar pago'}</button>${person?`<button class="ghost" data-edit="${person.id}">Editar</button>`:''}</div></div>`}).join('');
  el.querySelectorAll('[data-pay]').forEach(b=>{
    b.type='button';
    b.addEventListener('click',async()=>{
      const id=b.dataset.pay;
      const p=state.payments.find(x=>x.id===id);
      if(!p)return;
      const novoPago=!p.pago;
      const oldText=b.textContent;
      b.disabled=true;
      b.textContent=novoPago?'Salvando...':'Salvando...';
      try{
        const r=await db.from('pagamentos_secao').update({pago:novoPago,pago_em:novoPago?new Date().toISOString():null}).eq('id',id);
        if(r.error){toast('Erro ao salvar: '+r.error.message);return}
        p.pago=novoPago;
        p.pago_em=novoPago?new Date().toISOString():null;
        renderAll();
        toast(novoPago?'Pagamento marcado como pago.':'Pagamento desmarcado.');
      }catch(e){console.error(e);toast('Erro ao salvar pagamento: '+(e.message||e))}
      finally{b.disabled=false;b.textContent=oldText}
    },{passive:false});
  });
  el.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openParticipant(b.dataset.edit));
}
function renderStock(){
 const el=$('stockList');if(!state.stock.length){el.innerHTML='<div class="empty">Nenhum produto ativo.</div>';return}
 el.innerHTML=state.stock.map(s=>{const p=state.products.find(x=>x.id===s.produto_id);return `<div class="row"><div class="product-cell"><div class="row-title">${esc(p?.nome||'Produto')}</div><div class="muted">A comprar: <b>${Number(s.quantidade_a_comprar||0)}</b> ${esc(p?.unidade||'un')}</div></div><div class="row-actions"><label class="inline">Atual <input class="stock-in" data-id="${s.id}" value="${s.estoque_inicial}" type="number" min="0" step="0.01"></label><label class="inline">Desejado <input class="stock-des" data-id="${s.id}" value="${s.estoque_desejado}" type="number" min="0" step="0.01"></label><button class="ghost" data-stock="${s.id}">Salvar</button></div></div>`}).join('');
 el.querySelectorAll('[data-stock]').forEach(b=>{
  b.type='button';
  b.addEventListener('click',async()=>{
    const id=b.dataset.stock;
    const atual=el.querySelector('.stock-in[data-id="'+id+'"]');
    const desejado=el.querySelector('.stock-des[data-id="'+id+'"]');
    const item=state.stock.find(x=>x.id===id);
    if(!item||!atual||!desejado){toast('Não foi possível localizar este item.');return}
    const a=Number(atual.value)||0;
    const d=Number(desejado.value)||0;
    const oldText=b.textContent;
    b.disabled=true;b.textContent='Salvando...';
    try{
      const r=await db.from('estoque_secao').update({estoque_inicial:a,estoque_desejado:d,atualizado_em:new Date().toISOString()}).eq('id',id);
      if(r.error){toast('Erro ao salvar: '+r.error.message);return}
      item.estoque_inicial=a;
      item.estoque_desejado=d;
      toast('Estoque salvo.');
      renderAll();
    }catch(e){console.error(e);toast('Erro ao salvar estoque: '+(e.message||e))}
    finally{b.disabled=false;b.textContent=oldText}
  },{passive:false});
 })
}
function purchaseTotalFromDom(){
  let total=0;
  document.querySelectorAll('#purchaseList .purchase-fixed-row').forEach(row=>{
    const q=Number(row.querySelector('[data-pqty]')?.value)||0;
    const u=Number(row.querySelector('[data-punit]')?.value)||0;
    total+=q*u;
  });
  document.querySelectorAll('#purchaseList .purchase-custom-row').forEach(row=>{
    const q=Number(row.dataset.qty)||0,u=Number(row.dataset.unit)||0;
    total+=q*u;
  });
  return total;
}
function renderPurchases(){
  const el=$('purchaseList');
  const byProduct=new Map(state.purchases.filter(x=>x.produto_id).map(x=>[x.produto_id,x]));
  const fixed=state.products.map(p=>{
    const x=byProduct.get(p.id);
    const q=Number(x?.quantidade||0),u=Number(x?.valor_unitario||0),t=q*u;
    return `<div class="purchase-fixed-row" data-product="${p.id}">
      <div class="purchase-product"><div class="row-title">${esc(p.nome)}</div><div class="muted">${esc(p.unidade||'un')}</div></div>
      <label class="purchase-field">Quantidade<input data-pqty type="number" min="0" step="0.01" value="${q}"></label>
      <label class="purchase-field">Valor unitário<input data-punit type="number" min="0" step="0.01" value="${u}"></label>
      <div class="purchase-line"><span>Total</span><strong data-pline>${money(t)}</strong></div>
      <div class="purchase-actions"><button type="button" class="primary" data-psave="${p.id}">${x?'Salvar':'Registrar'}</button>${x?'<button type="button" class="ghost" data-pdel="'+x.id+'">Limpar</button>':''}</div>
    </div>`;
  }).join('');
  const customs=state.purchases.filter(x=>!x.produto_id).map(x=>`<div class="row purchase-custom-row" data-qty="${Number(x.quantidade)||0}" data-unit="${Number(x.valor_unitario)||0}">
    <div><div class="row-title">${esc(x.produto)}</div><div class="muted">${x.quantidade} × ${money(x.valor_unitario)}</div></div>
    <div class="row-actions"><span class="money">${money(Number(x.quantidade)*Number(x.valor_unitario))}</span><button type="button" class="ghost" data-pe="${x.id}">Editar</button><button type="button" class="ghost" data-pd="${x.id}">Excluir</button></div>
  </div>`).join('');
  el.innerHTML=fixed+(customs?`<div class="purchase-extra-title">Outros itens adicionados</div>${customs}`:'');
  $('purchaseTotal').textContent=money(purchaseTotalFromDom());
  el.querySelectorAll('[data-pqty],[data-punit]').forEach(inp=>inp.addEventListener('input',()=>{
    const row=inp.closest('.purchase-fixed-row'),q=Number(row.querySelector('[data-pqty]').value)||0,u=Number(row.querySelector('[data-punit]').value)||0;
    row.querySelector('[data-pline]').textContent=money(q*u);
    $('purchaseTotal').textContent=money(purchaseTotalFromDom());
  }));
  el.querySelectorAll('[data-psave]').forEach(b=>b.onclick=async()=>{
    const row=b.closest('.purchase-fixed-row'),productId=b.dataset.psave;
    const q=Number(row.querySelector('[data-pqty]').value)||0,u=Number(row.querySelector('[data-punit]').value)||0;
    const existing=state.purchases.find(x=>x.produto_id===productId);
    const product=state.products.find(x=>x.id===productId);
    b.disabled=true;b.textContent='Salvando...';
    try{
      let r;
      if(existing) r=await db.from('compras_secao').update({quantidade:q,valor_unitario:u,produto:product?.nome||existing.produto}).eq('id',existing.id);
      else r=await db.from('compras_secao').insert({competencia_id:state.month.id,produto_id:productId,produto:product?.nome||'Produto',quantidade:q,valor_unitario:u});
      if(r.error){toast('Erro ao salvar: '+r.error.message);return}
      toast('Compra salva.');
      await load();
    }catch(e){console.error(e);toast('Erro ao salvar compra: '+(e.message||e))}
    finally{b.disabled=false;b.textContent=existing?'Salvar':'Registrar'}
  });
  el.querySelectorAll('[data-pdel]').forEach(b=>b.onclick=async()=>{
    if(!confirm('Limpar este item da compra?'))return;
    const r=await db.from('compras_secao').delete().eq('id',b.dataset.pdel);
    if(r.error)toast(r.error.message);else load();
  });
  el.querySelectorAll('[data-pe]').forEach(b=>b.onclick=()=>openPurchase(b.dataset.pe));
  el.querySelectorAll('[data-pd]').forEach(b=>b.onclick=async()=>{if(confirm('Excluir este item?')){let r=await db.from('compras_secao').delete().eq('id',b.dataset.pd);if(r.error)toast(r.error.message);else load()}});
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
function closeDialog(id){const d=$(id);if(d?.open)d.close()} 
function openParticipant(id){const p=state.participants.find(x=>x.id===id);$('participantId').value=p?.id||'';$('participantName').value=p?.nome||'';$('participantActive').checked=p?.ativo??true;$('participantDialogTitle').textContent=p?'Editar participante':'Novo participante';$('participantDialog').showModal()}
$('participantDialog').querySelector('[value="cancel"]').type='button';$('participantDialog').querySelector('[value="cancel"]').onclick=()=>closeDialog('participantDialog');
$('purchaseDialog').querySelector('[value="cancel"]').type='button';$('purchaseDialog').querySelector('[value="cancel"]').onclick=()=>closeDialog('purchaseDialog');
$('nfDialog').querySelector('[value="cancel"]').type='button';$('nfDialog').querySelector('[value="cancel"]').onclick=()=>closeDialog('nfDialog');
async function saveParticipant(e){e.preventDefault();const id=$('participantId').value,name=$('participantName').value.trim(),ativo=$('participantActive').checked;if(!name)return;if(id){await db.from('participantes').update({nome,ativo}).eq('id',id)}else{const r=await db.from('participantes').insert({nome,ativo}).select().single();if(r.error){toast(r.error.message);return}await db.from('pagamentos_secao').insert({competencia_id:state.month.id,participante_id:r.data.id,valor:state.month.valor_padrao,pago:false})}$('participantDialog').close();load()}
function openPurchase(id){const x=state.purchases.find(p=>p.id===id);$('purchaseId').value=x?.id||'';$('purchaseProduct').innerHTML='<option value="">Manual</option>'+state.products.map(p=>`<option value="${p.id}">${esc(p.nome)}</option>`).join('');$('purchaseProduct').value=x?.produto_id||'';$('purchaseName').value=x?.produto||'';$('purchaseQty').value=x?.quantidade??1;$('purchaseUnit').value=x?.valor_unitario??0;$('purchaseObs').value=x?.observacao||'';$('purchaseDialog').showModal()}
async function savePurchase(e){e.preventDefault();const id=$('purchaseId').value,produto_id=$('purchaseProduct').value||null,produto=$('purchaseName').value.trim(),quantidade=Number($('purchaseQty').value)||0,valor_unitario=Number($('purchaseUnit').value)||0,observacao=$('purchaseObs').value.trim();if(!produto)return;const obj={competencia_id:state.month.id,produto_id,produto,quantidade,valor_unitario,observacao};let r=id?await db.from('compras_secao').update(obj).eq('id',id):await db.from('compras_secao').insert(obj);if(r.error)toast(r.error.message);else{$('purchaseDialog').close();load()}}
function openNf(id){
  const x=state.nfs.find(n=>n.id===id);
  $('nfId').value=x?.id||'';$('nfNumber').value=x?.numero_nf||'';$('nfSupplier').value=x?.fornecedor||'';
  $('nfDate').value=x?.data_nf||new Date().toISOString().slice(0,10);$('nfValue').value=x?.valor??0;$('nfObs').value=x?.observacao||'';
  $('nfFile').value='';
  $('nfFileName').textContent=x?.arquivo_path?'Arquivo já anexado.':'Nenhum arquivo selecionado.';
  $('nfDialog').showModal()
}
async function saveNf(e){
  e.preventDefault();
  const id=$('nfId').value,file=$('nfFile').files?.[0];
  const obj={competencia_id:state.month.id,numero_nf:$('nfNumber').value.trim(),fornecedor:$('nfSupplier').value.trim(),data_nf:$('nfDate').value||null,valor:Number($('nfValue').value)||0,observacao:$('nfObs').value.trim()};
  let r=id?await db.from('notas_fiscais_secao').update(obj).eq('id',id):await db.from('notas_fiscais_secao').insert(obj).select().single();
  if(r.error){toast(r.error.message);return}
  const nfRow=id?state.nfs.find(n=>n.id===id):r.data;
  if(file&&nfRow){
    const ext=(file.name.split('.').pop()||'bin').toLowerCase(),path=`${state.month.id}/${nfRow.id}-${Date.now()}.${ext}`;
    const up=await db.storage.from('notas-fiscais').upload(path,file,{upsert:true});
    if(up.error){toast('NF salva, mas não foi possível anexar o arquivo: '+up.error.message);$('nfDialog').close();load();return}
    const ur=await db.from('notas_fiscais_secao').update({arquivo_path:path}).eq('id',nfRow.id);
    if(ur.error){toast('NF salva, mas o caminho do arquivo não foi gravado.');$('nfDialog').close();load();return}
  }
  $('nfDialog').close();toast('Nota fiscal salva.');load()
}
async function generatePurchases(){let added=0;for(const s of state.stock){const qty=Number(s.quantidade_a_comprar||0);if(qty<=0)continue;const p=state.products.find(x=>x.id===s.produto_id);if(!p)continue;const already=state.purchases.find(x=>x.produto_id===p.id);if(already)continue;const r=await db.from('compras_secao').insert({competencia_id:state.month.id,produto_id:p.id,produto:p.nome,quantidade:qty,valor_unitario:0});if(!r.error)added++}toast(added?`${added} item(ns) adicionados à lista.`:'Nenhum novo item para adicionar.');load()}
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.tab-panel').forEach(x=>x.hidden=true);b.classList.add('active');$('tab-'+b.dataset.tab).hidden=false});
$('loginForm').onsubmit=async e=>{e.preventDefault();$('loginMsg').textContent='Entrando...';const r=await db.auth.signInWithPassword({email:$('email').value,password:$('password').value});if(r.error){$('loginMsg').textContent=r.error.message}else{await showApp()}};
$('logoutBtn').onclick=async()=>{await db.auth.signOut();$('appView').hidden=true;$('loginView').hidden=false};
$('refreshBtn').type='button';$('refreshBtn').onclick=()=>load();
$('prevMonthBtn').onclick=()=>changeMonth(-1);$('nextMonthBtn').onclick=()=>changeMonth(1);$('newParticipantBtn').type='button';$('newParticipantBtn').onclick=()=>openParticipant();$('participantForm').onsubmit=saveParticipant;$('newPurchaseBtn').type='button';$('newPurchaseBtn').onclick=()=>openPurchase();$('purchaseForm').onsubmit=savePurchase;$('newNfBtn').type='button';$('newNfBtn').onclick=()=>openNf();$('nfForm').onsubmit=saveNf;$('generatePurchasesBtn').type='button';$('generatePurchasesBtn').onclick=generatePurchases;
$('copyReportBtn').onclick=async()=>{await navigator.clipboard.writeText($('reportText').textContent);toast('Relatório copiado.')};
$('whatsappBtn').onclick=()=>window.open('https://wa.me/?text='+encodeURIComponent($('reportText').textContent),'_blank');
$('defaultAmount').onchange=async()=>{const v=Number($('defaultAmount').value)||0;await db.from('competencias').update({valor_padrao:v}).eq('id',state.month.id);await db.from('pagamentos_secao').update({valor:v}).eq('competencia_id',state.month.id).eq('pago',false);load()};
async function showApp(){$('loginView').hidden=true;$('appView').hidden=false;await load()}
(async()=>{if(!cfg.anonKey||cfg.anonKey.includes('COLE_AQUI')){console.warn('Configure config.js com a chave anon/public do Supabase.')}const s=await db.auth.getSession();if(s.data.session)await showApp()})();
