/**
 * db.js — Camada de persistência local (localStorage)
 * Simula um banco de dados para o Sistema de PDV.
 * Todas as entidades vivem sob o prefixo "pdvbr_".
 */

const DB_KEYS = {
  produtos: 'pdvbr_produtos',
  categorias: 'pdvbr_categorias',
  clientes: 'pdvbr_clientes',
  vendas: 'pdvbr_vendas',
  entradas: 'pdvbr_entradas_estoque',
  contasPagar: 'pdvbr_contas_pagar',
  prolabore: 'pdvbr_prolabore',
  caixa: 'pdvbr_caixa_sessoes',
  pagamentosFiado: 'pdvbr_pagamentos_fiado',
  mapeamentosCodigoNF: 'pdvbr_mapeamentos_codigo_nf',
  usuarios: 'pdvbr_usuarios',
  fornecedores: 'pdvbr_fornecedores',
  boletos: 'pdvbr_boletos',
  promocoes: 'pdvbr_promocoes',
  config: 'pdvbr_config',
};

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ------------------------------------------------------------------
// MODO ATUAL: 100% local, sem contas/login — a autenticação com
// Firebase foi removida temporariamente e deve voltar numa fase
// futura. Enquanto isso, chaveReal() é só um passa-adiante; existe pra
// manter a mesma "forma" de função que o resto do sistema já chama
// (ex: DB.chavePessoal), sem precisar mexer em cada tela quando as
// contas voltarem.
// ------------------------------------------------------------------
function chaveReal(key) {
  return key;
}

// ------------------------------------------------------------------
// Armazenamento seguro: usa localStorage quando disponível; se o
// navegador bloquear (comum ao abrir via file:// em vez de http://),
// cai automaticamente para memória (dura enquanto a aba ficar aberta)
// em vez de travar a página com uma tela em branco.
// ------------------------------------------------------------------
const memoryStore = {};
let storageDisponivel = true;
(function testarStorage() {
  try {
    const testKey = '__pdvbr_test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
  } catch (e) {
    storageDisponivel = false;
    console.warn('localStorage indisponível (abrindo via file://?). Usando memória temporária — os dados não serão salvos ao recarregar. Rode um servidor local (veja o README) para persistência real.');
  }
})();

function readAll(key) {
  const k = chaveReal(key);
  try {
    if (!storageDisponivel) return memoryStore[k] ? JSON.parse(memoryStore[k]) : [];
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Erro lendo', k, e);
    return [];
  }
}

function writeAll(key, arr, opts = {}) {
  const k = chaveReal(key);
  try {
    const raw = JSON.stringify(arr);
    if (!storageDisponivel) { memoryStore[k] = raw; } else { localStorage.setItem(k, raw); }
  } catch (e) {
    console.error('Erro salvando', k, e);
    memoryStore[k] = JSON.stringify(arr);
  }
  if (typeof agendarSalvarPasta === 'function') agendarSalvarPasta();
}

const DB = {
  // ---------- genérico ----------
  list(entity) {
    return readAll(DB_KEYS[entity]);
  },
  get(entity, id) {
    return readAll(DB_KEYS[entity]).find((r) => r.id === id) || null;
  },
  insert(entity, obj) {
    const all = readAll(DB_KEYS[entity]);
    const record = { id: uid(entity), ...obj };
    all.push(record);
    writeAll(DB_KEYS[entity], all);
    return record;
  },
  update(entity, id, patch) {
    const all = readAll(DB_KEYS[entity]);
    const idx = all.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...patch };
    writeAll(DB_KEYS[entity], all);
    return all[idx];
  },
  remove(entity, id) {
    const all = readAll(DB_KEYS[entity]).filter((r) => r.id !== id);
    writeAll(DB_KEYS[entity], all);
  },
  replaceAll(entity, arr) {
    writeAll(DB_KEYS[entity], arr);
  },

  // ---------- config ----------
  getConfig() {
    const k = chaveReal(DB_KEYS.config);
    const raw = storageDisponivel ? localStorage.getItem(k) : memoryStore[k];
    return raw
      ? { senhaAdmin: '1234', ...JSON.parse(raw) }
      : { nomeLoja: 'Mercadinho Lima', cnpj: '', endereco: '', larguraBobina: '80', socios: ['Proprietário'], senhaAdmin: '1234' };
  },
  setConfig(cfg) {
    const k = chaveReal(DB_KEYS.config);
    const raw = JSON.stringify(cfg);
    if (storageDisponivel) {
      try {
        localStorage.setItem(k, raw);
        if (typeof agendarSalvarPasta === 'function') agendarSalvarPasta();
        return;
      } catch (e) { /* fallback abaixo */ }
    }
    memoryStore[k] = raw;
    if (typeof agendarSalvarPasta === 'function') agendarSalvarPasta();
  },

  // ---------- caixa ----------
  getCaixaAberto() {
    return this.list('caixa').find((c) => c.status === 'aberto') || null;
  },

  /** Gera uma chave de localStorage "namespaced", pra uso de outras
   * telas que precisem guardar algo à parte (ex: rascunho da venda em
   * andamento) sem colidir com as chaves das entidades acima. Mantida
   * como função (em vez de montar a string na mão em cada lugar) pra
   * quando as contas por login voltarem, só essa função precisar mudar. */
  chavePessoal(nome) {
    return chaveReal(nome);
  },
};

// ------------------------------------------------------------------
// SEED — por pedido do lojista, o sistema começa 100% vazio (sem
// produtos, clientes, contas ou vendas de exemplo). Essa função fica
// aqui só como "gancho" caso algum dia se queira reativar dados de
// demonstração — hoje ela não faz nada.
// ------------------------------------------------------------------
function seedIfEmpty() {
  // intencionalmente vazio — nenhum dado de exemplo é criado
}

// (seedIfEmpty() é chamado mais abaixo, depois que DataFolder já existe —
// funções chamadas durante o seed tentam agendar o salvamento na pasta
// conectada, então DataFolder precisa estar definido antes disso)

// ==========================================================================
// PASTA DE DADOS — salvar tudo em uma pasta real do computador
// ==========================================================================
// Além do localStorage (que fica preso ao navegador), o sistema pode
// conectar uma pasta de verdade no disco (via File System Access API,
// suportado no Chrome/Edge) e manter um arquivo `pdvbr_dados.json` nela
// sempre atualizado. Em navegadores sem esse recurso (Firefox/Safari),
// fica disponível o Exportar/Importar backup manual — funciona em
// qualquer lugar e cumpre o mesmo papel: seus dados guardados em arquivo,
// fora do navegador.
// ==========================================================================

const DataFolder = {
  handle: null,
  nome: null,
  // pasta que já foi escolhida antes, mas perdeu a permissão de escrita
  // (ver tentarReconectar) — não nulo só quando existe algo pra reconectar
  handlePendente: null,
  nomePendente: null,
  // Exigido: contexto seguro (https/localhost) + API disponível. Isso deixa
  // o recurso desligado de propósito quando a página é aberta direto do
  // arquivo (file://) — nesse modo o Chrome bloqueia IndexedDB/File System
  // Access de forma inconsistente, então é mais seguro nem tentar e cair
  // direto no fallback manual de backup (que sempre funciona).
  suportado: typeof window !== 'undefined'
    && location.protocol !== 'file:'
    && 'showDirectoryPicker' in window,

  async conectar() {
    if (!this.suportado) {
      toast('Este navegador não permite conectar uma pasta diretamente. Use Exportar/Importar backup abaixo.', 'warning');
      return false;
    }
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      this.handle = dirHandle;
      this.nome = dirHandle.name;
      this.handlePendente = null;
      this.nomePendente = null;
      await salvarHandleNoIndexedDB(dirHandle);
      await this.salvarAgora();
      // silencioso: true pra não empilhar um segundo toast em cima do de
      // "pasta conectada" logo abaixo — o backup inicial acontece, só não
      // precisa anunciar duas coisas ao mesmo tempo
      await this.verificarBackupAutomatico({ silencioso: true });
      toast(`Pasta "${dirHandle.name}" conectada. Os dados agora são salvos nela automaticamente.`, 'success');
      return true;
    } catch (e) {
      if (e && e.name !== 'AbortError') console.error('Erro ao conectar pasta de dados', e);
      return false;
    }
  },

  async tentarReconectar() {
    if (!this.suportado) return;
    try {
      const dirHandle = await carregarHandleDoIndexedDB();
      if (!dirHandle) return;
      const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        this.handle = dirHandle;
        this.nome = dirHandle.name;
        return;
      }
      // Aqui está o motivo de "esquecer" a pasta depois de fechar o app:
      // o Chromium NÃO lembra a permissão de escrita de uma sessão pra
      // outra por segurança (mesmo lembrando qual pasta era) — só concede
      // de novo em resposta a um clique real da pessoa (não dá pra pedir
      // isso sozinho ao carregar a página). Então guarda o handle como
      // "pendente" pra badge/modal oferecerem um botão de reconectar com
      // 1 clique só, sem precisar escolher a pasta de novo do zero.
      this.handlePendente = dirHandle;
      this.nomePendente = dirHandle.name;
    } catch (e) {
      // pasta pode ter sido apagada/movida — apenas ignora e segue
    }
  },

  /**
   * Reconecta com 1 clique a pasta que já tinha sido escolhida antes,
   * mas que perdeu a permissão de escrita ao reabrir o app (ver nota em
   * tentarReconectar). Precisa ser chamada a partir de um clique de
   * verdade (onclick=...) — o navegador exige um gesto do usuário pra
   * mostrar a caixinha nativa de permissão.
   */
  async reconectarPastaPendente() {
    if (!this.handlePendente) return false;
    try {
      const novaPerm = await this.handlePendente.requestPermission({ mode: 'readwrite' });
      if (novaPerm !== 'granted') {
        toast('Permissão não concedida. A pasta continua desconectada.', 'warning');
        return false;
      }
      this.handle = this.handlePendente;
      this.nome = this.nomePendente;
      this.handlePendente = null;
      this.nomePendente = null;
      await this.salvarAgora();
      await this.verificarBackupAutomatico({ silencioso: true });
      toast(`Pasta "${this.nome}" reconectada.`, 'success');
      if (typeof atualizarBadgePasta === 'function') atualizarBadgePasta();
      return true;
    } catch (e) {
      console.error('Erro ao reconectar pasta', e);
      toast('Não foi possível reconectar a pasta.', 'error');
      return false;
    }
  },

  async salvarAgora() {
    if (!this.handle) return;
    try {
      const permAtual = await this.handle.queryPermission({ mode: 'readwrite' });
      if (permAtual !== 'granted') {
        const novaPerm = await this.handle.requestPermission({ mode: 'readwrite' });
        if (novaPerm !== 'granted') {
          this.ultimoErroBackup = 'Sem permissão de escrita nessa pasta. Reconecte a pasta em 📁 Dados.';
          return;
        }
      }
      const dados = exportarTodosDados();
      const fileHandle = await this.handle.getFileHandle('pdvbr_dados.json', { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(dados, null, 2));
      await writable.close();
    } catch (e) {
      this.ultimoErroBackup = (e && e.message) ? e.message : 'Erro desconhecido salvando na pasta';
      console.error('Erro salvando na pasta de dados', e);
    }
  },

  desconectar() {
    this.handle = null;
    this.nome = null;
    this.handlePendente = null;
    this.nomePendente = null;
    limparHandleIndexedDB();
  },

  ultimoErroBackup: null,

  /**
   * Cria de fato um arquivo de backup datado dentro da subpasta "backup"
   * (criada automaticamente na pasta conectada) — sem checar quando foi o
   * último. Quem decide QUANDO chamar isso são verificarBackupAutomatico()
   * (a cada 24h) e o fechamento de caixa (todo fechamento gera um backup,
   * que é o momento mais natural do dia pra isso).
   */
  async criarArquivoBackup() {
    if (!this.handle) return false;
    try {
      // garante permissão de ESCRITA explicitamente — o navegador às vezes
      // só concede leitura por padrão, e criar uma pasta nova exige escrita
      const permAtual = await this.handle.queryPermission({ mode: 'readwrite' });
      if (permAtual !== 'granted') {
        const novaPerm = await this.handle.requestPermission({ mode: 'readwrite' });
        if (novaPerm !== 'granted') {
          this.ultimoErroBackup = 'Sem permissão de escrita nessa pasta. Reconecte a pasta em 📁 Dados.';
          console.warn(this.ultimoErroBackup);
          return false;
        }
      }

      const agora = new Date();
      const pastaBackup = await this.handle.getDirectoryHandle('backup', { create: true });
      const pad = (n) => String(n).padStart(2, '0');
      const nomeArquivo = `pdvbr_backup_${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}_${pad(agora.getHours())}h${pad(agora.getMinutes())}.json`;
      const fileHandle = await pastaBackup.getFileHandle(nomeArquivo, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(exportarTodosDados(), null, 2));
      await writable.close();

      const cfg = DB.getConfig();
      DB.setConfig({ ...cfg, ultimoBackupAutomatico: agora.toISOString() });
      this.ultimoErroBackup = null;
      console.info('Backup salvo em backup/' + nomeArquivo);
      return true;
    } catch (e) {
      this.ultimoErroBackup = (e && e.message) ? e.message : 'Erro desconhecido no backup';
      console.error('Erro no backup', e);
      return false;
    }
  },

  /**
   * Backup diário: garante um backup pelo menos uma vez a cada 24h,
   * independente do caixa ser fechado ou não — é o que cobre o dia a dia
   * de quem esquece de fechar o caixa, ou fica com o sistema aberto
   * vários dias seguidos sem reiniciar.
   *
   * É chamado em 3 momentos:
   *  1) toda vez que a página carrega (reconectando a pasta salva);
   *  2) a cada 15 minutos enquanto o app fica aberto (setInterval abaixo);
   *  3) logo depois de conectar uma pasta pela primeira vez.
   * Em qualquer um desses casos, se já fizeram 24h desde o último backup
   * (seja ele diário OU do fechamento de caixa), um novo é criado agora.
   *
   * opts.silencioso evita mostrar o toast de sucesso quando quem chamou
   * já vai mostrar o próprio aviso (ex: acabou de conectar a pasta).
   */
  async verificarBackupAutomatico(opts = {}) {
    if (!this.handle) return false;
    const cfg = DB.getConfig();
    const ultimo = cfg.ultimoBackupAutomatico ? new Date(cfg.ultimoBackupAutomatico) : null;
    const agora = new Date();
    if (ultimo && (agora - ultimo) < 24 * 60 * 60 * 1000) return false; // ainda não faz 24h
    const ok = await this.criarArquivoBackup();
    if (ok && !opts.silencioso && typeof toast === 'function') {
      toast('📦 Backup automático do dia salvo na pasta', 'success');
    }
    return ok;
  },
};

let _salvarPastaTimer = null;
function agendarSalvarPasta() {
  if (!DataFolder.handle) return;
  clearTimeout(_salvarPastaTimer);
  _salvarPastaTimer = setTimeout(() => DataFolder.salvarAgora(), 600);
}

// -------- IndexedDB simples só para lembrar qual pasta foi escolhida --------
function abrirIndexedDBHandle() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open('pdvbr_handles', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('handles');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) {
      // alguns navegadores/contextos negam acesso ao IndexedDB de forma
      // síncrona (ex: file://, modo privado); captura pra nunca vazar
      // como erro não tratado
      reject(e);
    }
  });
}
async function salvarHandleNoIndexedDB(handle) {
  try {
    const idb = await abrirIndexedDBHandle();
    const tx = idb.transaction('handles', 'readwrite');
    tx.onerror = () => {};
    tx.objectStore('handles').put(handle, 'pastaDados');
  } catch (e) { console.warn('Não foi possível lembrar a pasta de dados', e); }
}
async function carregarHandleDoIndexedDB() {
  try {
    const idb = await abrirIndexedDBHandle();
    return await new Promise((resolve) => {
      try {
        const tx = idb.transaction('handles', 'readonly');
        tx.onerror = () => resolve(null);
        const req = tx.objectStore('handles').get('pastaDados');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  } catch (e) { return null; }
}
function limparHandleIndexedDB() {
  abrirIndexedDBHandle().then((idb) => {
    const tx = idb.transaction('handles', 'readwrite');
    tx.onerror = () => {};
    tx.objectStore('handles').delete('pastaDados');
  }).catch(() => {});
}

// -------- exportar / importar tudo (funciona em qualquer navegador) --------
function exportarTodosDados() {
  const dados = { _versao: 1, _exportadoEm: new Date().toISOString(), config: DB.getConfig() };
  Object.keys(DB_KEYS).forEach((entity) => {
    if (entity !== 'config') dados[entity] = readAll(DB_KEYS[entity]);
  });
  return dados;
}

function baixarBackupJSON() {
  const dados = exportarTodosDados();
  const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pdv-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importarBackupJSON(file, onDone) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const dados = JSON.parse(reader.result);
      Object.keys(DB_KEYS).forEach((entity) => {
        if (entity === 'config') { if (dados.config) DB.setConfig(dados.config); return; }
        if (Array.isArray(dados[entity])) writeAll(DB_KEYS[entity], dados[entity]);
      });
      if (onDone) onDone(true);
    } catch (e) {
      console.error('Erro importando backup', e);
      if (onDone) onDone(false);
    }
  };
  reader.readAsText(file);
}

// popula dados de exemplo (se necessário) agora que tudo acima já existe
seedIfEmpty();

// tenta reconectar silenciosamente numa pasta escolhida em sessão anterior
// (não faz nada se DataFolder.suportado for false — ex: aberto via file://)
try {
  DataFolder.tentarReconectar()
    .then(() => {
      // atualiza o badge da pasta no topo assim que a checagem termina
      // (pode ser antes ou depois do renderShell(), por isso não dá pra
      // confiar só no HTML que já foi desenhado)
      if (typeof atualizarBadgePasta === 'function') atualizarBadgePasta();
      // e, se sobrou uma pasta pendente de reconectar, avisa com um
      // aviso grande no meio da tela — não só o badge discreto
      if (typeof mostrarLembretePastaSeNecessario === 'function') mostrarLembretePastaSeNecessario();
      return DataFolder.verificarBackupAutomatico();
    })
    .catch(() => {});
} catch (e) {
  // nunca deixa esse recurso opcional derrubar o carregamento da página
}

// enquanto o app ficar aberto, rechecka a cada 15 minutos se já faz 24h
// desde o último backup automático (cobre quem deixa o sistema aberto o
// dia inteiro sem fechar, e também garante que o backup diário saia logo
// depois de completar as 24h, em vez de só na próxima vez que abrir o app)
setInterval(() => {
  try { DataFolder.verificarBackupAutomatico(); } catch (e) { /* ignora */ }
}, 15 * 60 * 1000);

// ==========================================================================
// AUTO-IMPORTAÇÃO — carrega pdvbr_dados.json se ele estiver dentro da
// própria pasta do projeto (ao lado do index.html). Isso permite "levar
// tudo num zip só": conecte a pasta de dados (📁 Dados) apontando pra essa
// mesma pasta do projeto — o sistema passa a manter o pdvbr_dados.json
// atualizado ali dentro. Quando você zipar a pasta toda e abrir em outro
// computador, este trecho detecta o arquivo e carrega os dados sozinho,
// sem precisar clicar em "Importar backup".
// Só roda se o navegador ainda não tiver NENHUM dado salvo (evita
// sobrescrever dados que já existem nesse computador) e só funciona
// servindo a pasta com http:// (não funciona abrindo via file://).
// ==========================================================================
async function tentarAutoImportarDadosDoArquivo() {
  const temAlgo = Object.keys(DB_KEYS).some((entity) => entity !== 'config' && readAll(DB_KEYS[entity]).length > 0);
  if (temAlgo) return;
  try {
    const resp = await fetch('pdvbr_dados.json', { cache: 'no-store' });
    if (!resp.ok) return;
    const dados = await resp.json();
    let importouAlgo = false;
    Object.keys(DB_KEYS).forEach((entity) => {
      if (entity === 'config') { if (dados.config) { DB.setConfig(dados.config); importouAlgo = true; } return; }
      if (Array.isArray(dados[entity]) && dados[entity].length > 0) { writeAll(DB_KEYS[entity], dados[entity]); importouAlgo = true; }
    });
    if (importouAlgo) {
      console.info('Dados carregados automaticamente de pdvbr_dados.json (arquivo dentro da pasta do projeto).');
      setTimeout(() => location.reload(), 150);
    }
  } catch (e) {
    // sem arquivo, sem servidor http, ou erro de rede — ignora silenciosamente
  }
}
// Agora que a versão web também é 100% local (sem Firestore), essa
// auto-importação passa a valer aqui também — mesmo comportamento que
// já existia na versão empacotada como app de Windows.
tentarAutoImportarDadosDoArquivo().catch(() => {});

// -------- apagar tudo (limpa produtos, clientes, vendas, caixa, financeiro) --------
function apagarTodosDadosLocais() {
  try {
    Object.values(DB_KEYS).forEach((key) => {
      const k = chaveReal(key);
      if (storageDisponivel) { try { localStorage.removeItem(k); } catch (e) { /* ignora */ } }
      delete memoryStore[k];
    });
  } catch (e) {
    console.error('Erro apagando dados locais', e);
  }
}
