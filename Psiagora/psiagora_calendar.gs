/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           PSIAGORA — Google Apps Script v3.0                ║
 * ║                Desenvolvido por Adventis                    ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * FUNCIONALIDADES:
 *   1. Disponibilidade em tempo real (lê o Google Calendar)
 *   2. Cria evento no Calendar com link Google Meet
 *   3. Email de confirmação ao cliente (com link Meet + link remarcação + cancelar)
 *   4. Email de notificação ao Frederico
 *   5. Lembrete automático ao cliente 24h antes da consulta
 *   6. Registo de todas as marcações numa Google Sheet
 *   7. Remarcação pelo cliente (até 4h antes, sem intervenção)
 *   8. Cancelamento pelo cliente (até 4h antes, sem intervenção)
 *   9. Reserva provisória pelo psicólogo (48h para pagar ou liberta)
 *
 * DEPLOY:
 *   script.google.com → Implementar → Nova implementação
 *   Executar como: Eu (frederico.e@psiagora.com)
 *   Quem tem acesso: Qualquer pessoa
 *
 * SERVIÇOS NECESSÁRIOS (adicionar em Serviços → +):
 *   - Google Calendar API (para criar eventos com Google Meet)
 */

// ─── ⚙️  CONFIGURAÇÃO — editar aqui ──────────────────────────────────────────

const CALENDAR_ID     = 'frederico.e@psiagora.com';
const EMAIL_FREDERICO = 'frederico.e@psiagora.com';
const NOME_PSICOLOGA  = 'Frederico Esgalhado';
const SITE_URL        = 'https://psiagora.com';
const DURACAO_MIN     = 50;
const FUSO_HORARIO    = 'Europe/Lisbon';

// Horas de trabalho (fallback se Calendar não responder)
const HORAS_TRABALHO  = ['09:00','10:00','11:00','14:00','15:00','16:00','17:00'];

// Token de segurança — igual ao do agendar.html / sucesso.html
const SECRET_TOKEN    = 'psiagora2026';

// Nome da Google Sheet onde ficam os registos (criada automaticamente)
const SHEET_NAME      = 'Psiagora — Marcações';

// Horas mínimas antes da consulta para permitir remarcação
const HORAS_MIN_REMARCAR = 4;

// ─────────────────────────────────────────────────────────────────────────────


// ══════════════════════════════════════════════════════════════════════════════
//  doGet — disponibilidade OU dados de uma marcação (para remarcação)
// ══════════════════════════════════════════════════════════════════════════════

function doGet(e) {
  try {
    // Confirmar reserva provisória (cliente pagou via link enviado por email)
    if (e.parameter.action === 'confirmarProvisorio') {
      return confirmarProvisorioFn(e.parameter.payToken || '');
    }

    // Buscar marcação por token (para página de remarcação/cancelamento)
    if (e.parameter.action === 'getBooking') {
      const token = e.parameter.token;
      if (!token) return jsonResponse({ error: 'Token em falta.' });
      const props = PropertiesService.getScriptProperties();
      const raw = props.getProperty('booking_' + token);
      if (!raw) return jsonResponse({ error: 'Marcação não encontrada.' });
      return jsonResponse({ success: true, booking: JSON.parse(raw) });
    }

    // Verificar se cliente já tem marcações anteriores (para definir tipo automaticamente)
    // ── Portal: listar todos os clientes ──────────────────────
    if (e.parameter.action === 'getClientes') {
      const portalToken = (e.parameter.token || '');
      const portalPass  = (PropertiesService.getScriptProperties().getProperty('PORTAL_TOKEN') || 'portal2026');
      if (portalToken !== portalPass) return jsonResponse({ error: 'unauthorized' });
      try {
        const props   = PropertiesService.getScriptProperties();
        const sheetId = props.getProperty('SHEET_ID');
        if (!sheetId) return jsonResponse({ clientes: [] });
        const sheet = SpreadsheetApp.openById(sheetId).getSheetByName('Marcações');
        if (!sheet) return jsonResponse({ clientes: [] });
        const rows = sheet.getDataRange().getValues();
        const clientes = [];
        const tz = Session.getScriptTimeZone();
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          clientes.push({
            timestamp: r[0] ? r[0].toString() : '',
            nome:      (r[1] || '').toString(),
            email:     (r[2] || '').toString(),
            telefone:  (r[3] || '').toString(),
            data:      r[4] instanceof Date ? Utilities.formatDate(r[4], tz, 'yyyy-MM-dd') : (r[4] || '').toString(),
            hora:      r[5] instanceof Date ? Utilities.formatDate(r[5], tz, 'HH:mm')      : (r[5] || '').toString(),
            tipo:      (r[6] || '').toString(),
            descricao: (r[9] || '').toString(), // col J — notas/motivo do cliente
          });
        }
        return jsonResponse({ clientes });
      } catch(err) {
        return jsonResponse({ error: err.message });
      }
    }

    // ── Portal: notas + ficheiros de um cliente ───────────────
    if (e.parameter.action === 'getNotasCliente') {
      const portalToken = (e.parameter.token || '');
      const portalPass  = (PropertiesService.getScriptProperties().getProperty('PORTAL_TOKEN') || 'portal2026');
      if (portalToken !== portalPass) return jsonResponse({ error: 'unauthorized' });

      const emailCliente = (e.parameter.email || '').toLowerCase().trim();
      if (!emailCliente) return jsonResponse({ sessoes: [], ficheiros: [] });

      try {
        const props = PropertiesService.getScriptProperties();
        const sheetId = props.getProperty('SHEET_ID');
        const sessoes = [];

        if (sheetId) {
          const sheet = SpreadsheetApp.openById(sheetId).getSheetByName('Marcações');
          if (sheet) {
            const rows = sheet.getDataRange().getValues();
            for (let i = 1; i < rows.length; i++) {
              const rowEmail = (rows[i][2] || '').toString().toLowerCase().trim();
              if (rowEmail === emailCliente) {
                const tz2 = Session.getScriptTimeZone();
                sessoes.push({
                  rowIndex: i + 1,
                  data:  rows[i][4] instanceof Date ? Utilities.formatDate(rows[i][4], tz2, 'yyyy-MM-dd') : (rows[i][4]  || '').toString(),
                  hora:  rows[i][5] instanceof Date ? Utilities.formatDate(rows[i][5], tz2, 'HH:mm')      : (rows[i][5]  || '').toString(),
                  tipo:  (rows[i][6]  || '').toString(),
                  notas: (rows[i][10] || '').toString(), // coluna K — Notas Clínicas
                });
              }
            }
          }
        }

        // Ficheiros guardados em ScriptProperties
        const filesKey = 'files_' + emailCliente.replace(/[^a-z0-9]/g, '_');
        let ficheiros = [];
        try { ficheiros = JSON.parse(props.getProperty(filesKey) || '[]'); } catch(e2) { ficheiros = []; }

        return jsonResponse({ sessoes, ficheiros });
      } catch(err) {
        return jsonResponse({ error: err.message, sessoes: [], ficheiros: [] });
      }
    }

    if (e.parameter.action === 'verificarCliente') {
      const email    = (e.parameter.email    || '').toLowerCase().trim();
      const telefone = (e.parameter.telefone || '').replace(/\D/g, '');
      if (!email && !telefone) return jsonResponse({ tipo: 'primeira' });
      try {
        const props = PropertiesService.getScriptProperties();

        // 1. Verificar na Google Sheet
        const sheetId = props.getProperty('SHEET_ID');
        if (sheetId) {
          try {
            const ss    = SpreadsheetApp.openById(sheetId);
            const sheet = ss.getSheetByName('Marcações') || ss.getSheets()[0];
            if (sheet) {
              const rows = sheet.getDataRange().getValues();
              // Colunas: [0]=DataRegisto [1]=Nome [2]=Email [3]=Telefone ...
              for (let i = 1; i < rows.length; i++) {
                const rowEmail = (rows[i][2] || '').toString().toLowerCase().trim();
                const rowTel   = (rows[i][3] || '').toString().replace(/\D/g, '');
                if ((email    && rowEmail === email)    ||
                    (telefone && telefone.length >= 9 && rowTel === telefone)) {
                  return jsonResponse({ tipo: 'seguimento' });
                }
              }
            }
          } catch(sheetErr) { Logger.log('Sheet verificar err: ' + sheetErr.message); }
        }

        // 2. Fallback: verificar booking_ tokens em ScriptProperties
        // (cobre casos em que a Sheet não tem registo mas o cliente já agendou)
        const allProps = props.getProperties();
        for (const key of Object.keys(allProps)) {
          if (!key.startsWith('booking_')) continue;
          try {
            const b      = JSON.parse(allProps[key]);
            const bEmail = (b.email    || '').toLowerCase().trim();
            const bTel   = (b.telefone || '').replace(/\D/g, '');
            if ((email    && bEmail === email)    ||
                (telefone && telefone.length >= 9 && bTel === telefone)) {
              return jsonResponse({ tipo: 'seguimento' });
            }
          } catch(e2) { /* ignora entradas corrompidas */ }
        }

        return jsonResponse({ tipo: 'primeira' });
      } catch(err) {
        return jsonResponse({ tipo: 'primeira' });
      }
    }

    // Disponibilidade de um dia (uso existente)
    const date = e.parameter.date;
    if (!date) return jsonResponse({ error: 'Parâmetro "date" ou "action" obrigatório.' });
    const slots = getAvailableSlots(date);
    return jsonResponse({ date, available: slots });

  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}


// ══════════════════════════════════════════════════════════════════════════════
//  doPost — criar marcação OU remarcar
// ══════════════════════════════════════════════════════════════════════════════

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // ── Remarcação pelo cliente ──────────────────────────────────────────────
    if (data.action === 'remarcar') {
      return processarRemarcacao(data);
    }

    // ── Cancelamento pelo cliente ────────────────────────────────────────────
    if (data.action === 'cancelarConsulta') {
      return processarCancelamento(data);
    }

    // ── Guardar nota clínica ─────────────────────────────────────────────────
    if (data.action === 'guardarNota') {
      const portalToken = (data.token || '');
      const portalPass  = (PropertiesService.getScriptProperties().getProperty('PORTAL_TOKEN') || 'portal2026');
      if (portalToken !== portalPass) return jsonResponse({ error: 'Não autorizado.' });

      const { email, dataConsulta, hora, nota } = data;
      if (!email || !dataConsulta || !hora) return jsonResponse({ error: 'Dados em falta.' });

      try {
        const props   = PropertiesService.getScriptProperties();
        const sheetId = props.getProperty('SHEET_ID');
        if (!sheetId) return jsonResponse({ error: 'Sheet não configurada.' });

        const ss    = SpreadsheetApp.openById(sheetId);
        const sheet = ss.getSheetByName('Marcações');
        if (!sheet) return jsonResponse({ error: 'Tab Marcações não encontrada.' });

        // Garantir que a coluna K (índice 10) tem cabeçalho
        const lastCol = sheet.getLastColumn();
        if (lastCol < 11) {
          sheet.getRange(1, 11).setValue('Notas Clínicas')
            .setFontWeight('bold').setBackground('#2A0753').setFontColor('#ffffff');
        }

        const rows      = sheet.getDataRange().getValues();
        const emailNorm = email.toLowerCase().trim();
        let found       = false;

        for (let i = 1; i < rows.length; i++) {
          const rowEmail = (rows[i][2] || '').toString().toLowerCase().trim();
          const rowData  = (rows[i][4] || '').toString();
          const rowHora  = (rows[i][5] || '').toString();
          if (rowEmail === emailNorm && rowData === dataConsulta && rowHora === hora) {
            sheet.getRange(i + 1, 11).setValue(nota || '');
            found = true;
            break;
          }
        }

        if (!found) return jsonResponse({ error: 'Sessão não encontrada na Sheet.' });
        return jsonResponse({ success: true });
      } catch(err) {
        return jsonResponse({ error: err.message });
      }
    }

    // ── Upload de ficheiro para Google Drive ─────────────────────────────────
    if (data.action === 'uploadFicheiro') {
      const portalToken = (data.token || '');
      const portalPass  = (PropertiesService.getScriptProperties().getProperty('PORTAL_TOKEN') || 'portal2026');
      if (portalToken !== portalPass) return jsonResponse({ error: 'Não autorizado.' });

      const { email, nomeCliente, filename, mimetype, dataBase64 } = data;
      if (!email || !filename || !dataBase64) return jsonResponse({ error: 'Dados em falta.' });

      try {
        // Criar/encontrar pasta raiz
        const rootName = 'Psiagora — Documentos Clientes';
        let rootFolder;
        const rootSearch = DriveApp.getFoldersByName(rootName);
        rootFolder = rootSearch.hasNext() ? rootSearch.next() : DriveApp.createFolder(rootName);

        // Subpasta por cliente
        const clientName = nomeCliente || email;
        let clientFolder;
        const clientSearch = rootFolder.getFoldersByName(clientName);
        clientFolder = clientSearch.hasNext() ? clientSearch.next() : rootFolder.createFolder(clientName);

        // Criar ficheiro
        const decoded  = Utilities.base64Decode(dataBase64);
        const blob     = Utilities.newBlob(decoded, mimetype || 'application/octet-stream', filename);
        const file     = clientFolder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

        const fileId      = file.getId();
        const fileUrl     = file.getUrl();
        const downloadUrl = 'https://drive.google.com/uc?export=download&id=' + fileId;

        // Guardar referência em ScriptProperties
        const props    = PropertiesService.getScriptProperties();
        const filesKey = 'files_' + email.toLowerCase().replace(/[^a-z0-9]/g, '_');
        let ficheiros  = [];
        try { ficheiros = JSON.parse(props.getProperty(filesKey) || '[]'); } catch(e2) { ficheiros = []; }

        ficheiros.unshift({ fileId, filename, fileUrl, downloadUrl, uploadedAt: new Date().toISOString() });
        if (ficheiros.length > 50) ficheiros = ficheiros.slice(0, 50);
        props.setProperty(filesKey, JSON.stringify(ficheiros));

        return jsonResponse({ success: true, fileId, fileUrl, downloadUrl, filename });
      } catch(err) {
        return jsonResponse({ error: err.message });
      }
    }

    // ── Enviar documento ao cliente por email ────────────────────────────────
    if (data.action === 'enviarDocumento') {
      const portalToken = (data.token || '');
      const portalPass  = (PropertiesService.getScriptProperties().getProperty('PORTAL_TOKEN') || 'portal2026');
      if (portalToken !== portalPass) return jsonResponse({ error: 'Não autorizado.' });

      const { emailCliente, nomeCliente, filename, fileUrl, downloadUrl, mensagem } = data;
      if (!emailCliente || !filename || !fileUrl) return jsonResponse({ error: 'Dados em falta.' });

      const msg = mensagem || `Segue em anexo o documento "${filename}".`;

      const html = `
<!DOCTYPE html>
<html lang="pt">
<head><meta charset="UTF-8"></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#F7F8FA;margin:0;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">
    <div style="background:#2A0753;padding:28px 32px;">
      <div style="color:#00C48C;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">Psiagora</div>
      <h1 style="color:#fff;margin:0;font-size:20px;font-weight:800;">📎 Documento partilhado</h1>
    </div>
    <div style="padding:28px 32px;">
      <p style="color:#1C1430;font-size:15px;margin:0 0 16px;">Olá <strong>${nomeCliente || ''}</strong>,</p>
      <p style="color:#4A4263;font-size:14px;line-height:1.7;margin:0 0 20px;">${msg}</p>
      <div style="background:#EAF5EF;border-radius:10px;padding:16px;margin-bottom:20px;display:flex;align-items:center;gap:12px;">
        <span style="font-size:24px;">📄</span>
        <div><div style="font-weight:600;font-size:14px;color:#1C1430;">${filename}</div></div>
      </div>
      <div style="text-align:center;">
        <a href="${downloadUrl || fileUrl}" style="background:#3D8C6A;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;">Abrir documento</a>
      </div>
      <p style="color:#B8ADDA;font-size:12px;margin-top:24px;text-align:center;">Enviado pelo Dr. ${NOME_PSICOLOGA} via Psiagora</p>
    </div>
    <div style="background:#F5F3FA;padding:16px 32px;text-align:center;border-top:1px solid #E8E4F0;">
      <span style="color:#B8ADDA;font-size:11px;">© 2026 Psiagora · <a href="${SITE_URL}" style="color:#B8ADDA;">${SITE_URL}</a></span>
    </div>
  </div>
</body>
</html>`;

      try {
        MailApp.sendEmail({
          to: emailCliente,
          subject: `Documento de ${NOME_PSICOLOGA}: ${filename}`,
          htmlBody: html,
          name: `Psiagora — ${NOME_PSICOLOGA}`,
          replyTo: EMAIL_FREDERICO,
        });
        return jsonResponse({ success: true });
      } catch(err) {
        return jsonResponse({ error: err.message });
      }
    }

    // ── Reserva provisória pelo psicólogo ────────────────────────────────────
    if (data.action === 'criarProvisorio') {
      return processarProvisorio(data);
    }

    // ── Nova marcação ────────────────────────────────────────────────────────
    if (data.token !== SECRET_TOKEN) return jsonResponse({ error: 'Não autorizado.' });

    const { nome, email, telefone, data: dataStr, hora, tipo, descricao } = data;
    if (!nome || !email || !dataStr || !hora || !tipo)
      return jsonResponse({ error: 'Campos obrigatórios em falta.' });

    // 1. Criar evento no Calendar com Google Meet
    const { eventoId, meetLink } = criarEvento({ nome, email, telefone, dataStr, hora, tipo, descricao });

    // 2. Gerar token único para remarcação
    const bookingToken = Utilities.getUuid();
    const props = PropertiesService.getScriptProperties();
    props.setProperty('booking_' + bookingToken, JSON.stringify({
      nome, email, telefone, dataStr, hora, tipo, descricao, meetLink, eventoId
    }));

    // 3. Registar na Google Sheet
    try { registarNaSheet({ nome, email, telefone, dataStr, hora, tipo, descricao, meetLink }); } catch(e) { Logger.log('Sheet err: '+e.message); }

    // 4. Email de confirmação ao cliente (com link de remarcação)
    try { enviarEmailCliente({ nome, email, dataStr, hora, tipo, meetLink, bookingToken }); } catch(e) { Logger.log('Email cliente err: '+e.message); }

    // 5. Email de notificação ao Frederico
    try { enviarEmailFrederico({ nome, email, telefone, dataStr, hora, tipo, descricao }); } catch(e) { Logger.log('Email Frederico err: '+e.message); }

    // 6. Agendar lembrete 24h antes
    try { agendarLembrete({ nome, email, dataStr, hora, meetLink }); } catch(e) { Logger.log('Lembrete err: '+e.message); }

    return jsonResponse({ success: true, eventoId, meetLink });

  } catch (err) {
    Logger.log('Erro doPost: ' + err.message);
    return jsonResponse({ error: err.message });
  }
}


// ══════════════════════════════════════════════════════════════════════════════
//  7. Remarcação
// ══════════════════════════════════════════════════════════════════════════════

function processarRemarcacao(data) {
  const { bookingToken, novaData, novaHora } = data;
  if (!bookingToken || !novaData || !novaHora)
    return jsonResponse({ error: 'Dados de remarcação incompletos.' });

  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('booking_' + bookingToken);
  if (!raw) return jsonResponse({ error: 'Marcação não encontrada ou token inválido.' });

  const booking = JSON.parse(raw);

  // Verificar se ainda faltam mais de 4h para a consulta actual
  const [y, mo, d] = booking.dataStr.split('-').map(Number);
  const [h, m]     = booking.hora.split(':').map(Number);
  const consultaActual = new Date(y, mo - 1, d, h, m, 0);
  const agora = new Date();
  const horasRestantes = (consultaActual.getTime() - agora.getTime()) / (1000 * 60 * 60);

  if (horasRestantes < HORAS_MIN_REMARCAR) {
    return jsonResponse({
      error: 'prazo',
      message: `Só é possível remarcar até ${HORAS_MIN_REMARCAR} horas antes da consulta. Para alterações de última hora contacte ${EMAIL_FREDERICO}.`
    });
  }

  // Verificar disponibilidade da nova hora
  const slotsDisponiveis = getAvailableSlots(novaData);
  if (!slotsDisponiveis.includes(novaHora)) {
    return jsonResponse({ error: 'slot', message: 'Este horário já não está disponível. Por favor escolha outro.' });
  }

  // Apagar evento antigo do Calendar
  try {
    if (booking.eventoId) {
      Calendar.Events.remove(CALENDAR_ID, booking.eventoId);
    }
  } catch(err) {
    Logger.log('Erro ao apagar evento antigo: ' + err.message);
  }

  // Criar novo evento
  const { eventoId: novoEventoId, meetLink: novoMeetLink } = criarEvento({
    nome:      booking.nome,
    email:     booking.email,
    telefone:  booking.telefone || '',
    dataStr:   novaData,
    hora:      novaHora,
    tipo:      booking.tipo,
    descricao: booking.descricao || '',
  });

  // Actualizar token com nova marcação (mantém o mesmo token)
  const novaBooking = {
    ...booking,
    dataStr:  novaData,
    hora:     novaHora,
    meetLink: novoMeetLink,
    eventoId: novoEventoId,
  };
  props.setProperty('booking_' + bookingToken, JSON.stringify(novaBooking));

  // Email de confirmação da remarcação ao cliente
  try { enviarEmailRemarcacao({ ...novaBooking, bookingToken }); } catch(e) { Logger.log('Email remarcacao err: '+e.message); }

  // Notificar Frederico
  try { enviarEmailFredericoRemarcacao({ ...novaBooking, dataAnterior: booking.dataStr, horaAnterior: booking.hora }); } catch(e) { Logger.log('Email Frederico remarcacao err: '+e.message); }

  return jsonResponse({ success: true, eventoId: novoEventoId, meetLink: novoMeetLink });
}


// ══════════════════════════════════════════════════════════════════════════════
//  1. Disponibilidade
// ══════════════════════════════════════════════════════════════════════════════

function getAvailableSlots(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const startOfDay = new Date(year, month - 1, day, 0, 0, 0);
  const endOfDay   = new Date(year, month - 1, day, 23, 59, 59);

  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!calendar) throw new Error('Calendário não encontrado: ' + CALENDAR_ID);

  const eventos = calendar.getEvents(startOfDay, endOfDay);

  // Dia inteiro → sem horas disponíveis
  if (eventos.some(ev => ev.isAllDayEvent())) return [];

  const ocupados = eventos.map(ev => ({
    inicio: ev.getStartTime().getTime(),
    fim:    ev.getEndTime().getTime(),
  }));

  return HORAS_TRABALHO.filter(hora => {
    const [h, m] = hora.split(':').map(Number);
    const slotInicio = new Date(year, month - 1, day, h, m, 0).getTime();
    const slotFim    = new Date(year, month - 1, day, h, m + DURACAO_MIN, 0).getTime();
    return !ocupados.some(ev => slotInicio < ev.fim && slotFim > ev.inicio);
  });
}


// ══════════════════════════════════════════════════════════════════════════════
//  2. Criar evento no Calendar com Google Meet
// ══════════════════════════════════════════════════════════════════════════════

function criarEvento({ nome, email, telefone, dataStr, hora, tipo, descricao }) {
  const [year, month, day] = dataStr.split('-').map(Number);
  const [h, m]             = hora.split(':').map(Number);

  const inicio = new Date(year, month - 1, day, h, m, 0);
  const fim    = new Date(inicio.getTime() + DURACAO_MIN * 60 * 1000);

  const preco     = tipo === 'seguinte' ? '50,00 €' : '65,00 €';
  const tipoTexto = tipo === 'seguinte' ? 'Consulta de seguimento' : 'Primeira consulta';
  const titulo    = `🧠 ${tipoTexto} — ${nome}`;

  const descEvento = [
    `Cliente: ${nome}`,
    `Email: ${email}`,
    telefone ? `Telefone: ${telefone}` : '',
    `Tipo: ${tipoTexto}`,
    `Valor: ${preco}`,
    descricao ? `\nNota do cliente:\n${descricao}` : '',
    '\n— Agendamento via psiagora.com',
  ].filter(Boolean).join('\n');

  let meetLink = '';
  let eventoId = '';

  try {
    const eventResource = {
      summary:     titulo,
      description: descEvento,
      start:  { dateTime: inicio.toISOString(), timeZone: FUSO_HORARIO },
      end:    { dateTime: fim.toISOString(),    timeZone: FUSO_HORARIO },
      attendees: [{ email: email }],
      conferenceData: {
        createRequest: {
          requestId: Utilities.getUuid(),
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email',  minutes: 60 },
          { method: 'popup',  minutes: 15 },
        ],
      },
    };

    const criado = Calendar.Events.insert(eventResource, CALENDAR_ID, { conferenceDataVersion: 1 });
    eventoId = criado.id;
    meetLink = criado.conferenceData?.entryPoints?.[0]?.uri || '';

  } catch (err) {
    Logger.log('Fallback CalendarApp: ' + err.message);
    const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
    const evento = calendar.createEvent(titulo, inicio, fim, {
      description: descEvento,
      sendInvites: true,
      guests: email,
    });
    eventoId = evento.getId();
  }

  return { eventoId, meetLink };
}


// ══════════════════════════════════════════════════════════════════════════════
//  3. Email de confirmação ao cliente
// ══════════════════════════════════════════════════════════════════════════════

function enviarEmailCliente({ nome, email, dataStr, hora, tipo, meetLink, bookingToken }) {
  const [year, month, day] = dataStr.split('-').map(Number);
  const dt = new Date(year, month - 1, day);
  const dataFormatada = dt.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const preco     = tipo === 'seguinte' ? '50,00 €' : '65,00 €';
  const tipoTexto = tipo === 'seguinte' ? 'Consulta de seguimento' : 'Primeira consulta';
  const geriURL = bookingToken ? `${SITE_URL}/gerir.html?token=${bookingToken}` : '';

  const meetSection = meetLink
    ? `<tr><td style="padding:10px 16px;color:#5A6678;font-size:13px;">Link da videochamada</td><td style="padding:10px 16px;font-weight:600;font-size:13px;"><a href="${meetLink}" style="color:#3D8C6A;">Entrar no Google Meet</a></td></tr>`
    : '';

  const html = `
<!DOCTYPE html>
<html lang="pt">
<head><meta charset="UTF-8"></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#F7F8FA;margin:0;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">
    <div style="background:#2A0753;padding:28px 32px;">
      <div style="color:#00C48C;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">Psiagora</div>
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800;">Consulta confirmada ✓</h1>
    </div>
    <div style="padding:28px 32px;">
      <p style="color:#1C1430;font-size:15px;margin:0 0 20px;">Olá <strong>${nome}</strong>,</p>
      <p style="color:#4A4263;font-size:14px;line-height:1.7;margin:0 0 24px;">
        O seu pagamento foi processado com sucesso. Aqui estão os detalhes da sua consulta:
      </p>
      <table style="width:100%;border-collapse:collapse;background:#F5F3FA;border-radius:8px;overflow:hidden;">
        <tr style="border-bottom:1px solid #E8E4F0;">
          <td style="padding:10px 16px;color:#5A6678;font-size:13px;">Data</td>
          <td style="padding:10px 16px;font-weight:600;font-size:13px;color:#1C1430;text-transform:capitalize;">${dataFormatada}</td>
        </tr>
        <tr style="border-bottom:1px solid #E8E4F0;">
          <td style="padding:10px 16px;color:#5A6678;font-size:13px;">Hora</td>
          <td style="padding:10px 16px;font-weight:600;font-size:13px;color:#1C1430;">${hora}</td>
        </tr>
        <tr style="border-bottom:1px solid #E8E4F0;">
          <td style="padding:10px 16px;color:#5A6678;font-size:13px;">Tipo</td>
          <td style="padding:10px 16px;font-weight:600;font-size:13px;color:#1C1430;">${tipoTexto}</td>
        </tr>
        <tr style="border-bottom:1px solid #E8E4F0;">
          <td style="padding:10px 16px;color:#5A6678;font-size:13px;">Duração</td>
          <td style="padding:10px 16px;font-weight:600;font-size:13px;color:#1C1430;">50 minutos</td>
        </tr>
        <tr style="border-bottom:1px solid #E8E4F0;">
          <td style="padding:10px 16px;color:#5A6678;font-size:13px;">Valor pago</td>
          <td style="padding:10px 16px;font-weight:600;font-size:13px;color:#00C48C;">${preco}</td>
        </tr>
        ${meetSection}
      </table>
      ${meetLink ? `
      <div style="margin-top:24px;text-align:center;">
        <a href="${meetLink}" style="background:#2A0753;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;">
          Entrar na videochamada
        </a>
        <p style="color:#B8ADDA;font-size:12px;margin-top:10px;">O link estará disponível na hora da consulta.</p>
      </div>` : ''}
      ${geriURL ? `
      <div style="margin-top:20px;padding:16px;background:#EAF5EF;border-radius:8px;border-left:3px solid #3D8C6A;">
        <p style="color:#1C1430;font-size:13px;margin:0 0 8px;font-weight:600;">Precisa de alterar ou cancelar?</p>
        <p style="color:#4A4263;font-size:12px;margin:0 0 10px;line-height:1.6;">Pode remarcar ou cancelar até ${HORAS_MIN_REMARCAR} horas antes da consulta, sem necessidade de contactar.</p>
        <a href="${geriURL}" style="color:#3D8C6A;font-size:12px;font-weight:700;text-decoration:none;">→ Gerir marcação</a>
      </div>` : ''}
      <p style="color:#4A4263;font-size:13px;line-height:1.7;margin-top:24px;">
        Receberá um lembrete 24 horas antes da consulta. Se precisar de ajuda contacte-nos em
        <a href="mailto:${EMAIL_FREDERICO}" style="color:#3D8C6A;">${EMAIL_FREDERICO}</a>.
      </p>
    </div>
    <div style="background:#F5F3FA;padding:16px 32px;text-align:center;border-top:1px solid #E8E4F0;">
      <span style="color:#B8ADDA;font-size:11px;">© 2026 Psiagora · <a href="${SITE_URL}" style="color:#B8ADDA;">${SITE_URL}</a></span>
    </div>
  </div>
</body>
</html>`;

  MailApp.sendEmail({
    to: email,
    subject: `Consulta confirmada — ${dataFormatada} às ${hora}`,
    htmlBody: html,
    name: `Psiagora — ${NOME_PSICOLOGA}`,
    replyTo: EMAIL_FREDERICO,
  });
}


// ══════════════════════════════════════════════════════════════════════════════
//  4. Email de notificação ao Frederico
// ══════════════════════════════════════════════════════════════════════════════

function enviarEmailFrederico({ nome, email, telefone, dataStr, hora, tipo, descricao }) {
  const [year, month, day] = dataStr.split('-').map(Number);
  const dt = new Date(year, month - 1, day);
  const dataFormatada = dt.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const tipoTexto = tipo === 'seguinte' ? 'Consulta de seguimento (50€)' : 'Primeira consulta (65€)';

  const html = `
<!DOCTYPE html>
<html lang="pt">
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#F7F8FA;margin:0;padding:24px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">
    <div style="background:#00C48C;padding:20px 28px;">
      <h1 style="color:#fff;margin:0;font-size:18px;font-weight:800;">🗓️ Nova marcação recebida</h1>
    </div>
    <div style="padding:24px 28px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr style="border-bottom:1px solid #E8E4F0;">
          <td style="padding:8px 0;color:#5A6678;font-size:13px;width:120px;">Cliente</td>
          <td style="padding:8px 0;font-weight:600;font-size:13px;">${nome}</td>
        </tr>
        <tr style="border-bottom:1px solid #E8E4F0;">
          <td style="padding:8px 0;color:#5A6678;font-size:13px;">Email</td>
          <td style="padding:8px 0;font-size:13px;"><a href="mailto:${email}" style="color:#3D8C6A;">${email}</a></td>
        </tr>
        ${telefone ? `<tr style="border-bottom:1px solid #E8E4F0;"><td style="padding:8px 0;color:#5A6678;font-size:13px;">Telefone</td><td style="padding:8px 0;font-size:13px;">${telefone}</td></tr>` : ''}
        <tr style="border-bottom:1px solid #E8E4F0;">
          <td style="padding:8px 0;color:#5A6678;font-size:13px;">Data</td>
          <td style="padding:8px 0;font-weight:600;font-size:13px;text-transform:capitalize;">${dataFormatada}</td>
        </tr>
        <tr style="border-bottom:1px solid #E8E4F0;">
          <td style="padding:8px 0;color:#5A6678;font-size:13px;">Hora</td>
          <td style="padding:8px 0;font-weight:600;font-size:13px;">${hora}</td>
        </tr>
        <tr style="border-bottom:1px solid #E8E4F0;">
          <td style="padding:8px 0;color:#5A6678;font-size:13px;">Tipo</td>
          <td style="padding:8px 0;font-weight:600;font-size:13px;">${tipoTexto}</td>
        </tr>
        ${descricao ? `<tr><td style="padding:8px 0;color:#5A6678;font-size:13px;vertical-align:top;">Nota</td><td style="padding:8px 0;font-size:13px;color:#4A4263;">${descricao}</td></tr>` : ''}
      </table>
      <p style="color:#B8ADDA;font-size:11px;margin-top:20px;">O evento foi adicionado ao teu Google Calendar e o cliente já recebeu confirmação.</p>
    </div>
  </div>
</body>
</html>`;

  MailApp.sendEmail({
    to: EMAIL_FREDERICO,
    subject: `🗓️ Nova consulta: ${nome} — ${dataFormatada} às ${hora}`,
    htmlBody: html,
    name: 'Psiagora Agendamentos',
  });
}


// ══════════════════════════════════════════════════════════════════════════════
//  Email de confirmação de remarcação ao cliente
// ══════════════════════════════════════════════════════════════════════════════

function enviarEmailRemarcacao({ nome, email, dataStr, hora, tipo, meetLink, bookingToken }) {
  const [year, month, day] = dataStr.split('-').map(Number);
  const dt = new Date(year, month - 1, day);
  const dataFormatada = dt.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const tipoTexto = tipo === 'seguinte' ? 'Consulta de seguimento' : 'Primeira consulta';
  const geriURL = `${SITE_URL}/gerir.html?token=${bookingToken}`;

  const html = `
<!DOCTYPE html>
<html lang="pt">
<head><meta charset="UTF-8"></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#F7F8FA;margin:0;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">
    <div style="background:#2A0753;padding:28px 32px;">
      <div style="color:#00C48C;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">Psiagora</div>
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800;">Consulta remarcada ✓</h1>
    </div>
    <div style="padding:28px 32px;">
      <p style="color:#1C1430;font-size:15px;margin:0 0 20px;">Olá <strong>${nome}</strong>,</p>
      <p style="color:#4A4263;font-size:14px;line-height:1.7;margin:0 0 24px;">
        A sua consulta foi remarcada com sucesso. Os novos detalhes:
      </p>
      <table style="width:100%;border-collapse:collapse;background:#F5F3FA;border-radius:8px;overflow:hidden;">
        <tr style="border-bottom:1px solid #E8E4F0;">
          <td style="padding:10px 16px;color:#5A6678;font-size:13px;">Nova data</td>
          <td style="padding:10px 16px;font-weight:600;font-size:13px;color:#1C1430;text-transform:capitalize;">${dataFormatada}</td>
        </tr>
        <tr style="border-bottom:1px solid #E8E4F0;">
          <td style="padding:10px 16px;color:#5A6678;font-size:13px;">Nova hora</td>
          <td style="padding:10px 16px;font-weight:600;font-size:13px;color:#1C1430;">${hora}</td>
        </tr>
        <tr style="border-bottom:1px solid #E8E4F0;">
          <td style="padding:10px 16px;color:#5A6678;font-size:13px;">Tipo</td>
          <td style="padding:10px 16px;font-weight:600;font-size:13px;color:#1C1430;">${tipoTexto}</td>
        </tr>
        ${meetLink ? `<tr><td style="padding:10px 16px;color:#5A6678;font-size:13px;">Google Meet</td><td style="padding:10px 16px;font-weight:600;font-size:13px;"><a href="${meetLink}" style="color:#3D8C6A;">Entrar na videochamada</a></td></tr>` : ''}
      </table>
      <div style="margin-top:20px;padding:16px;background:#EAF5EF;border-radius:8px;border-left:3px solid #3D8C6A;">
        <a href="${geriURL}" style="color:#3D8C6A;font-size:12px;font-weight:700;text-decoration:none;">→ Remarcar novamente</a>
        <span style="color:#B8ADDA;font-size:11px;margin-left:8px;">(até ${HORAS_MIN_REMARCAR}h antes)</span>
      </div>
    </div>
    <div style="background:#F5F3FA;padding:16px 32px;text-align:center;border-top:1px solid #E8E4F0;">
      <span style="color:#B8ADDA;font-size:11px;">© 2026 Psiagora · <a href="${SITE_URL}" style="color:#B8ADDA;">${SITE_URL}</a></span>
    </div>
  </div>
</body>
</html>`;

  MailApp.sendEmail({
    to: email,
    subject: `Consulta remarcada — ${dataFormatada} às ${hora}`,
    htmlBody: html,
    name: `Psiagora — ${NOME_PSICOLOGA}`,
    replyTo: EMAIL_FREDERICO,
  });
}


// ══════════════════════════════════════════════════════════════════════════════
//  Email de notificação ao Frederico sobre remarcação
// ══════════════════════════════════════════════════════════════════════════════

function enviarEmailFredericoRemarcacao({ nome, email, dataStr, hora, dataAnterior, horaAnterior }) {
  const fmt = (ds) => {
    const [y,mo,d] = ds.split('-').map(Number);
    return new Date(y, mo-1, d).toLocaleDateString('pt-PT', { weekday:'long', day:'numeric', month:'long' });
  };

  const html = `
<!DOCTYPE html>
<html lang="pt">
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#F7F8FA;margin:0;padding:24px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">
    <div style="background:#4A90D9;padding:20px 28px;">
      <h1 style="color:#fff;margin:0;font-size:18px;font-weight:800;">🔄 Consulta remarcada</h1>
    </div>
    <div style="padding:24px 28px;">
      <p style="color:#1C1430;font-size:14px;"><strong>${nome}</strong> (<a href="mailto:${email}" style="color:#3D8C6A;">${email}</a>) remarcou a consulta:</p>
      <table style="width:100%;border-collapse:collapse;margin-top:12px;">
        <tr style="border-bottom:1px solid #E8E4F0;">
          <td style="padding:8px 0;color:#5A6678;font-size:13px;width:100px;">Anterior</td>
          <td style="padding:8px 0;font-size:13px;text-decoration:line-through;color:#B8ADDA;text-transform:capitalize;">${fmt(dataAnterior)} às ${horaAnterior}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#5A6678;font-size:13px;">Nova data</td>
          <td style="padding:8px 0;font-weight:700;font-size:13px;color:#1C1430;text-transform:capitalize;">${fmt(dataStr)} às ${hora}</td>
        </tr>
      </table>
      <p style="color:#B8ADDA;font-size:11px;margin-top:20px;">O evento no Google Calendar foi actualizado automaticamente.</p>
    </div>
  </div>
</body>
</html>`;

  MailApp.sendEmail({
    to: EMAIL_FREDERICO,
    subject: `🔄 Consulta remarcada: ${nome} → ${fmt(dataStr)} às ${hora}`,
    htmlBody: html,
    name: 'Psiagora Agendamentos',
  });
}


// ══════════════════════════════════════════════════════════════════════════════
//  5. Lembrete automático 24h antes
// ══════════════════════════════════════════════════════════════════════════════

function agendarLembrete({ nome, email, dataStr, hora, meetLink }) {
  try {
    const [year, month, day] = dataStr.split('-').map(Number);
    const [h, m]             = hora.split(':').map(Number);

    const consultaTime = new Date(year, month - 1, day, h, m, 0);
    const lembrete24h  = new Date(consultaTime.getTime() - 24 * 60 * 60 * 1000);

    if (lembrete24h <= new Date()) return;

    const props = PropertiesService.getScriptProperties();
    const key   = 'reminder_' + Utilities.getUuid();
    props.setProperty(key, JSON.stringify({ nome, email, dataStr, hora, meetLink }));

    ScriptApp.newTrigger('enviarLembrete')
      .timeBased()
      .at(lembrete24h)
      .create();

    props.setProperty('next_reminder_key', key);

  } catch (err) {
    Logger.log('Erro ao agendar lembrete: ' + err.message);
  }
}

function enviarLembrete() {
  try {
    const props = PropertiesService.getScriptProperties();
    const key   = props.getProperty('next_reminder_key');
    if (!key) return;

    const b = JSON.parse(props.getProperty(key) || '{}');
    if (!b.email) return;

    const [year, month, day] = b.dataStr.split('-').map(Number);
    const dt = new Date(year, month - 1, day);
    const dataFormatada = dt.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });

    const meetBtn = b.meetLink
      ? `<div style="text-align:center;margin-top:20px;"><a href="${b.meetLink}" style="background:#2A0753;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">Entrar no Google Meet</a></div>`
      : '';

    const html = `
<!DOCTYPE html>
<html lang="pt">
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#F7F8FA;margin:0;padding:24px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">
    <div style="background:#2A0753;padding:20px 28px;">
      <h1 style="color:#00C48C;margin:0;font-size:18px;font-weight:800;">⏰ Lembrete — consulta amanhã</h1>
    </div>
    <div style="padding:24px 28px;">
      <p style="color:#1C1430;font-size:15px;">Olá <strong>${b.nome}</strong>,</p>
      <p style="color:#4A4263;font-size:14px;line-height:1.7;">
        Este é um lembrete de que tem uma consulta marcada para <strong style="color:#2A0753;">${dataFormatada} às ${b.hora}</strong>.
      </p>
      ${meetBtn}
      <p style="color:#B8ADDA;font-size:12px;margin-top:20px;">
        Para cancelar ou remarcar: <a href="mailto:${EMAIL_FREDERICO}" style="color:#3D8C6A;">${EMAIL_FREDERICO}</a>
      </p>
    </div>
  </div>
</body>
</html>`;

    MailApp.sendEmail({
      to: b.email,
      subject: `Lembrete: consulta amanhã às ${b.hora}`,
      htmlBody: html,
      name: `Psiagora — ${NOME_PSICOLOGA}`,
      replyTo: EMAIL_FREDERICO,
    });

    props.deleteProperty(key);
    props.deleteProperty('next_reminder_key');

  } catch (err) {
    Logger.log('Erro enviarLembrete: ' + err.message);
  }
}


// ══════════════════════════════════════════════════════════════════════════════
//  6. Registo na Google Sheet
// ══════════════════════════════════════════════════════════════════════════════

function registarNaSheet({ nome, email, telefone, dataStr, hora, tipo, descricao, meetLink }) {
  try {
    const tipoTexto = (tipo === 'seguimento' || tipo === 'seguinte') ? 'Seguimento' : 'Primeira';
    const preco     = tipo === 'seguinte' ? 50 : 65;
    const agora     = new Date().toLocaleString('pt-PT', { timeZone: FUSO_HORARIO });

    let ss;
    const props = PropertiesService.getScriptProperties();
    const sheetId = props.getProperty('SHEET_ID');

    if (sheetId) {
      try { ss = SpreadsheetApp.openById(sheetId); } catch(e) { ss = null; }
    }

    if (!ss) {
      ss = SpreadsheetApp.create(SHEET_NAME);
      props.setProperty('SHEET_ID', ss.getId());
      const header = ss.getActiveSheet();
      header.setName('Marcações');
      header.appendRow(['Data registo','Nome','Email','Telefone','Data consulta','Hora','Tipo','Valor (€)','Google Meet','Notas']);
      header.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#2A0753').setFontColor('#ffffff');
      header.setFrozenRows(1);
    }

    const sheet = ss.getSheetByName('Marcações') || ss.getSheets()[0];
    sheet.appendRow([agora, nome, email, telefone || '', dataStr, hora, tipoTexto, preco, meetLink || '', descricao || '']);

  } catch (err) {
    Logger.log('Erro ao registar na Sheet: ' + err.message);
  }
}


// ══════════════════════════════════════════════════════════════════════════════
//  Utilitário
// ══════════════════════════════════════════════════════════════════════════════

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


// ══════════════════════════════════════════════════════════════════════════════
//  8. Cancelamento pelo cliente
// ══════════════════════════════════════════════════════════════════════════════

function processarCancelamento(data) {
  const { bookingToken } = data;
  if (!bookingToken) return jsonResponse({ error: 'Token em falta.' });

  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('booking_' + bookingToken);
  if (!raw) return jsonResponse({ error: 'Marcação não encontrada ou token inválido.' });

  const booking = JSON.parse(raw);

  // Verificar prazo (mínimo HORAS_MIN_REMARCAR horas antes)
  const [y, mo, d] = booking.dataStr.split('-').map(Number);
  const [h, m]     = booking.hora.split(':').map(Number);
  const consultaTime = new Date(y, mo - 1, d, h, m, 0);
  const horasRestantes = (consultaTime.getTime() - Date.now()) / (1000 * 60 * 60);

  if (horasRestantes < HORAS_MIN_REMARCAR) {
    return jsonResponse({
      error: 'prazo',
      message: `Só é possível cancelar até ${HORAS_MIN_REMARCAR} horas antes da consulta. Para cancelamentos de última hora contacte ${EMAIL_FREDERICO}.`
    });
  }

  // Apagar evento do Calendar
  try {
    if (booking.eventoId) Calendar.Events.remove(CALENDAR_ID, booking.eventoId);
  } catch(err) { Logger.log('Erro ao apagar evento (cancelamento): ' + err.message); }

  // Marcar como cancelado na Sheet
  try { marcarCanceladoNaSheet(booking); } catch(e) { Logger.log('Sheet cancel err: ' + e.message); }

  // Emails de cancelamento
  try { enviarEmailCancelamento(booking); } catch(e) { Logger.log('Email cancel cliente: ' + e.message); }
  try { enviarEmailFredericoCancelamento(booking); } catch(e) { Logger.log('Email cancel Frederico: ' + e.message); }

  // Remover token
  props.deleteProperty('booking_' + bookingToken);

  return jsonResponse({ success: true });
}

function marcarCanceladoNaSheet(booking) {
  const props   = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty('SHEET_ID');
  if (!sheetId) return;
  const sheet = SpreadsheetApp.openById(sheetId).getSheetByName('Marcações');
  if (!sheet) return;
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][2] || '').toString().toLowerCase() === (booking.email || '').toLowerCase() &&
        (rows[i][4] || '').toString() === booking.dataStr &&
        (rows[i][5] || '').toString() === booking.hora) {
      // Coluna J (índice 9) = Notas — acrescenta "CANCELADO"
      const notasCell = sheet.getRange(i + 1, 10);
      notasCell.setValue('CANCELADO — ' + new Date().toLocaleString('pt-PT'));
      break;
    }
  }
}

function enviarEmailCancelamento({ nome, email, dataStr, hora }) {
  const [year, month, day] = dataStr.split('-').map(Number);
  const dt = new Date(year, month - 1, day);
  const dataFormatada = dt.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const html = `
<!DOCTYPE html>
<html lang="pt">
<head><meta charset="UTF-8"></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#F7F8FA;margin:0;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">
    <div style="background:#2A0753;padding:28px 32px;">
      <div style="color:#00C48C;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">Psiagora</div>
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800;">Consulta cancelada</h1>
    </div>
    <div style="padding:28px 32px;">
      <p style="color:#1C1430;font-size:15px;margin:0 0 16px;">Olá <strong>${nome}</strong>,</p>
      <p style="color:#4A4263;font-size:14px;line-height:1.7;margin:0 0 16px;">
        A sua consulta de <strong style="color:#1C1430;text-transform:capitalize;">${dataFormatada} às ${hora}</strong> foi cancelada com sucesso.
      </p>
      <p style="color:#4A4263;font-size:13px;line-height:1.7;margin:0 0 20px;">
        Quando quiser marcar uma nova sessão, pode fazê-lo em qualquer altura em <a href="${SITE_URL}/equipa.html" style="color:#3D8C6A;font-weight:600;">psiagora.com</a>.
      </p>
      <div style="text-align:center;margin-top:8px;">
        <a href="${SITE_URL}/equipa.html" style="background:#3D8C6A;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;">Marcar nova consulta</a>
      </div>
    </div>
    <div style="background:#F5F3FA;padding:16px 32px;text-align:center;border-top:1px solid #E8E4F0;">
      <span style="color:#B8ADDA;font-size:11px;">© 2026 Psiagora · <a href="${SITE_URL}" style="color:#B8ADDA;">${SITE_URL}</a></span>
    </div>
  </div>
</body>
</html>`;

  MailApp.sendEmail({
    to: email,
    subject: `Consulta cancelada — ${dataFormatada} às ${hora}`,
    htmlBody: html,
    name: `Psiagora — ${NOME_PSICOLOGA}`,
    replyTo: EMAIL_FREDERICO,
  });
}

function enviarEmailFredericoCancelamento({ nome, email, dataStr, hora }) {
  const [y, mo, d] = dataStr.split('-').map(Number);
  const dataFormatada = new Date(y, mo-1, d).toLocaleDateString('pt-PT', { weekday:'long', day:'numeric', month:'long' });

  MailApp.sendEmail({
    to: EMAIL_FREDERICO,
    subject: `❌ Consulta cancelada: ${nome} — ${dataFormatada} às ${hora}`,
    htmlBody: `<p style="font-family:sans-serif;font-size:14px;"><strong>${nome}</strong> (<a href="mailto:${email}">${email}</a>) cancelou a consulta de <strong>${dataFormatada} às ${hora}</strong>. O evento foi removido do Calendar.</p>`,
    name: 'Psiagora Agendamentos',
  });
}


// ══════════════════════════════════════════════════════════════════════════════
//  9. Reserva provisória pelo psicólogo
// ══════════════════════════════════════════════════════════════════════════════

function processarProvisorio(data) {
  const portalToken = (data.token || '');
  const portalPass  = (PropertiesService.getScriptProperties().getProperty('PORTAL_TOKEN') || 'portal2026');
  if (portalToken !== portalPass) return jsonResponse({ error: 'Não autorizado.' });

  const { nome, email, telefone, dataStr, hora, tipo } = data;
  if (!nome || !email || !dataStr || !hora)
    return jsonResponse({ error: 'Campos obrigatórios em falta.' });

  // Verificar disponibilidade
  const slots = getAvailableSlots(dataStr);
  if (!slots.includes(hora))
    return jsonResponse({ error: 'slot', message: 'Este horário já não está disponível.' });

  // Gerar token de pagamento único
  const payToken = Utilities.getUuid();

  // Calcular deadline: 48h antes da consulta
  const [y, mo, d] = dataStr.split('-').map(Number);
  const [h, m]     = hora.split(':').map(Number);
  const consultaTime = new Date(y, mo - 1, d, h, m, 0);
  const deadline     = new Date(consultaTime.getTime() - 48 * 60 * 60 * 1000);

  // Guardar em Properties
  const props = PropertiesService.getScriptProperties();
  props.setProperty('provisorio_' + payToken, JSON.stringify({
    nome, email, telefone: telefone || '', dataStr, hora,
    tipo: tipo || 'seguimento',
    deadline: deadline.toISOString(),
    status: 'provisorio',
  }));

  // Email ao cliente com link de pagamento
  try { enviarEmailProvisorioCliente({ nome, email, dataStr, hora, tipo: tipo || 'seguimento', payToken, deadline }); }
  catch(e) { Logger.log('Email provisorio: ' + e.message); }

  // Notificar Frederico
  const [yr2, mo2, d2] = dataStr.split('-').map(Number);
  const dfmt = new Date(yr2, mo2-1, d2).toLocaleDateString('pt-PT', { weekday:'long', day:'numeric', month:'long' });
  try {
    MailApp.sendEmail({
      to: EMAIL_FREDERICO,
      subject: `🕐 Reserva provisória criada: ${nome} — ${dfmt} às ${hora}`,
      htmlBody: `<p style="font-family:sans-serif;font-size:14px;">Reserva provisória criada para <strong>${nome}</strong> (${email}) em <strong>${dfmt} às ${hora}</strong>.<br>Prazo de pagamento: <strong>${deadline.toLocaleString('pt-PT')}</strong>.<br>Se não pagar até essa hora, o horário será libertado automaticamente.</p>`,
      name: 'Psiagora Agendamentos',
    });
  } catch(e) { Logger.log('Email Frederico provisorio: ' + e.message); }

  return jsonResponse({ success: true, payToken, deadline: deadline.toISOString() });
}

function enviarEmailProvisorioCliente({ nome, email, dataStr, hora, tipo, payToken, deadline }) {
  const [year, month, day] = dataStr.split('-').map(Number);
  const dt = new Date(year, month - 1, day);
  const dataFormatada = dt.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const deadlineFmt   = deadline.toLocaleString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const preco         = tipo === 'seguimento' ? '50,00 €' : '65,00 €';
  const tipoTexto     = tipo === 'seguimento' ? 'Consulta de seguimento' : 'Primeira consulta';
  // Link: quando Stripe estiver activo, substituir pelo link Stripe + ?client_reference_id=payToken
  // Por agora (modo de teste): link directo para confirmar
  const payLink = `${SITE_URL}/sucesso.html?payToken=${payToken}`;

  const html = `
<!DOCTYPE html>
<html lang="pt">
<head><meta charset="UTF-8"></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#F7F8FA;margin:0;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">
    <div style="background:#2A0753;padding:28px 32px;">
      <div style="color:#F59E0B;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">Psiagora — Reserva Provisória</div>
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800;">O Dr. Frederico reservou um horário para si</h1>
    </div>
    <div style="padding:28px 32px;">
      <p style="color:#1C1430;font-size:15px;margin:0 0 16px;">Olá <strong>${nome}</strong>,</p>
      <p style="color:#4A4263;font-size:14px;line-height:1.7;margin:0 0 20px;">
        Foi reservado provisoriamente o seguinte horário para si. Para confirmar a sua sessão, efectue o pagamento antes do prazo indicado.
      </p>
      <table style="width:100%;border-collapse:collapse;background:#F5F3FA;border-radius:8px;overflow:hidden;margin-bottom:20px;">
        <tr style="border-bottom:1px solid #E8E4F0;">
          <td style="padding:10px 16px;color:#5A6678;font-size:13px;">Data</td>
          <td style="padding:10px 16px;font-weight:600;font-size:13px;color:#1C1430;text-transform:capitalize;">${dataFormatada}</td>
        </tr>
        <tr style="border-bottom:1px solid #E8E4F0;">
          <td style="padding:10px 16px;color:#5A6678;font-size:13px;">Hora</td>
          <td style="padding:10px 16px;font-weight:600;font-size:13px;color:#1C1430;">${hora}</td>
        </tr>
        <tr style="border-bottom:1px solid #E8E4F0;">
          <td style="padding:10px 16px;color:#5A6678;font-size:13px;">Tipo</td>
          <td style="padding:10px 16px;font-weight:600;font-size:13px;color:#1C1430;">${tipoTexto}</td>
        </tr>
        <tr style="border-bottom:1px solid #E8E4F0;">
          <td style="padding:10px 16px;color:#5A6678;font-size:13px;">Valor</td>
          <td style="padding:10px 16px;font-weight:600;font-size:13px;color:#3D8C6A;">${preco}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;color:#DC2626;font-size:13px;font-weight:600;">Pagar até</td>
          <td style="padding:10px 16px;font-weight:700;font-size:13px;color:#DC2626;text-transform:capitalize;">${deadlineFmt}</td>
        </tr>
      </table>
      <div style="background:#FFF8E1;border:1.5px solid #F59E0B;border-radius:10px;padding:16px;margin-bottom:20px;">
        <p style="color:#92400E;font-size:13px;font-weight:700;margin:0 0 4px;">⚠️ Atenção</p>
        <p style="color:#78350F;font-size:12px;line-height:1.6;margin:0;">Se o pagamento não for efectuado até ao prazo indicado, o horário será automaticamente libertado.</p>
      </div>
      <div style="text-align:center;">
        <a href="${payLink}" style="background:#3D8C6A;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;">Confirmar e Pagar — ${preco}</a>
      </div>
    </div>
    <div style="background:#F5F3FA;padding:16px 32px;text-align:center;border-top:1px solid #E8E4F0;">
      <span style="color:#B8ADDA;font-size:11px;">© 2026 Psiagora · <a href="${SITE_URL}" style="color:#B8ADDA;">${SITE_URL}</a></span>
    </div>
  </div>
</body>
</html>`;

  MailApp.sendEmail({
    to: email,
    subject: `Horário reservado para si — confirme até ${deadline.toLocaleDateString('pt-PT')}`,
    htmlBody: html,
    name: `Psiagora — ${NOME_PSICOLOGA}`,
    replyTo: EMAIL_FREDERICO,
  });
}

function confirmarProvisorioFn(payToken) {
  if (!payToken) return jsonResponse({ error: 'Token de pagamento em falta.' });

  const props = PropertiesService.getScriptProperties();
  const raw   = props.getProperty('provisorio_' + payToken);
  if (!raw) return jsonResponse({ error: 'Reserva não encontrada. Pode já ter sido confirmada ou expirado.' });

  const b = JSON.parse(raw);
  if (b.status !== 'provisorio') return jsonResponse({ error: 'Esta reserva já foi processada.' });

  // Criar evento no Calendar com Meet
  const { eventoId, meetLink } = criarEvento({
    nome: b.nome, email: b.email, telefone: b.telefone,
    dataStr: b.dataStr, hora: b.hora, tipo: b.tipo, descricao: 'Reserva provisória confirmada',
  });

  // Gerar bookingToken para gestão futura (remarcar/cancelar)
  const bookingToken = Utilities.getUuid();
  props.setProperty('booking_' + bookingToken, JSON.stringify({
    nome: b.nome, email: b.email, telefone: b.telefone,
    dataStr: b.dataStr, hora: b.hora, tipo: b.tipo, descricao: '',
    meetLink, eventoId,
  }));

  // Registar na Sheet
  try { registarNaSheet({ nome: b.nome, email: b.email, telefone: b.telefone, dataStr: b.dataStr, hora: b.hora, tipo: b.tipo, descricao: 'Provisório confirmado', meetLink }); }
  catch(e) { Logger.log('Sheet provisorio: ' + e.message); }

  // Email de confirmação ao cliente
  try { enviarEmailCliente({ nome: b.nome, email: b.email, dataStr: b.dataStr, hora: b.hora, tipo: b.tipo, meetLink, bookingToken }); }
  catch(e) { Logger.log('Email confirmação provisorio: ' + e.message); }

  // Notificar Frederico
  try { enviarEmailFrederico({ nome: b.nome, email: b.email, telefone: b.telefone, dataStr: b.dataStr, hora: b.hora, tipo: b.tipo, descricao: 'Reserva provisória paga e confirmada' }); }
  catch(e) { Logger.log('Email Frederico provisorio confirmado: ' + e.message); }

  // Remover a entrada provisória
  props.deleteProperty('provisorio_' + payToken);

  return jsonResponse({
    success: true, meetLink, bookingToken,
    nome: b.nome, dataStr: b.dataStr, hora: b.hora, tipo: b.tipo,
  });
}

/**
 * TRIGGER: Corre de hora em hora (configurar em Triggers no editor Apps Script).
 * Liberta reservas provisórias cujo prazo de pagamento passou.
 */
function liberarProvisionaisExpirados() {
  const props = PropertiesService.getScriptProperties();
  const allProps = props.getProperties();
  const agora = new Date();

  Object.keys(allProps).forEach(key => {
    if (!key.startsWith('provisorio_')) return;
    try {
      const b = JSON.parse(allProps[key]);
      if (b.status !== 'provisorio') return;
      const deadline = new Date(b.deadline);
      if (agora >= deadline) {
        // Prazo expirou — libertar
        props.deleteProperty(key);
        // Notificar Frederico
        const [y,mo,d] = b.dataStr.split('-').map(Number);
        const dfmt = new Date(y,mo-1,d).toLocaleDateString('pt-PT', { weekday:'long', day:'numeric', month:'long' });
        MailApp.sendEmail({
          to: EMAIL_FREDERICO,
          subject: `⏰ Reserva provisória expirada: ${b.nome} — ${dfmt} às ${b.hora}`,
          htmlBody: `<p style="font-family:sans-serif;font-size:14px;">A reserva provisória de <strong>${b.nome}</strong> (${b.email}) para <strong>${dfmt} às ${b.hora}</strong> expirou sem pagamento. O horário está novamente disponível.</p>`,
          name: 'Psiagora Agendamentos',
        });
        Logger.log('Provisório expirado e libertado: ' + b.nome + ' ' + b.dataStr);
      }
    } catch(e) {
      Logger.log('Erro ao verificar provisório ' + key + ': ' + e.message);
    }
  });
}


// ══════════════════════════════════════════════════════════════════════════════
//  TESTE — corre directamente no editor para verificar envio de email
// ══════════════════════════════════════════════════════════════════════════════

function testEmail() {
  MailApp.sendEmail({
    to: 'rui@adventishub.com',
    subject: 'Teste MailApp Psiagora v2.2',
    htmlBody: '<p>Se recebeste este email, o <strong>MailApp funciona</strong> e os emails de confirmação vão chegar aos clientes!</p>',
    name: 'Psiagora'
  });
  Logger.log('Email enviado via MailApp para rui@adventishub.com');
}
