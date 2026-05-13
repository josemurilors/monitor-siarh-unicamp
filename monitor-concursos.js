require('dotenv').config();
const { chromium } = require('playwright');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'dados-concursos.json');
const URL = 'https://www.siarh.unicamp.br/concurso/ConcursosEncerrados.jsf';

const TARGET_CONTESTS = [
  { id: '123/2022', area: 'PR TECNOLOGIA INFO COM', cargo: 'Administrador de redes' },
  { id: '125/2022', area: 'PR TECNOLOGIA INFO COM', cargo: 'Analista de suporte computacional' },
  { id: '24/2024', area: 'PR ARTE CULT COMUNICACAO', cargo: 'Técnico em multimeios didáticos' },
];

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS.replace(/\s+/g, '');
const EMAIL_TO = process.env.EMAIL_TO;
const EMAIL_FROM = process.env.EMAIL_FROM;
const SUBJECT = process.env.ALERT_SUBJECT;

function extractConvocados(html) {
  const geralMatch = html.match(/Candidatos da lista final geral:\s*convocados até a classificação\s*(\d+)/);
  const geralNone = /Candidatos da lista final geral:\s*nenhum convocado/.test(html);
  const negros = html.match(/Candidatos da lista final especial \(candidatos negros - pretos ou pardos\):\s*convocados até a classificação\s*(\d+)/);
  const deficiencia = html.match(/Candidatos da lista final especial \(candidatos com deficiência\):\s*convocados até a classificação\s*(\d+)/);

  return {
    convocados_geral: geralMatch ? parseInt(geralMatch[1]) : (geralNone ? 0 : -1),
    convocados_negros: negros ? parseInt(negros[1]) : -1,
    convocados_deficiencia: deficiencia ? parseInt(deficiencia[1]) : -1,
  };
}

async function extractFromPage(page) {
  return await page.$$eval('.panelInscricoesAbertasInterno', cards =>
    cards.map(card => {
      const h2 = card.querySelector('h2')?.textContent?.trim() || '';
      const html = card.innerHTML;
      const geralMatch = html.match(/Candidatos da lista final geral:\s*convocados até a classificação\s*(\d+)/);
      const geralNone = /Candidatos da lista final geral:\s*nenhum convocado/.test(html);
      const negros = html.match(/Candidatos da lista final especial \(candidatos negros - pretos ou pardos\):\s*convocados até a classificação\s*(\d+)/);
      const deficiencia = html.match(/Candidatos da lista final especial \(candidatos com deficiência\):\s*convocados até a classificação\s*(\d+)/);
      return {
        titulo: h2,
        convocados_geral: geralMatch ? parseInt(geralMatch[1]) : (geralNone ? 0 : -1),
        convocados_negros: negros ? parseInt(negros[1]) : -1,
        convocados_deficiencia: deficiencia ? parseInt(deficiencia[1]) : -1,
      };
    })
  );
}

function matchTargets(cards) {
  const results = [];
  for (const card of cards) {
    for (const target of TARGET_CONTESTS) {
      if (card.titulo.includes(`Concurso ${target.id}`)) {
        results.push({
          numero: target.id,
          area: target.area,
          cargo: target.cargo,
          convocados_geral: card.convocados_geral,
          convocados_negros: card.convocados_negros,
          convocados_deficiencia: card.convocados_deficiencia,
        });
      }
    }
  }
  return results;
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function saveState(data) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function compareState(oldData, newData) {
  const changes = [];
  for (const novo of newData) {
    const antigo = oldData?.find(o => o.numero === novo.numero);
    if (!antigo) {
      changes.push({ ...novo, tipo: 'novo' });
    } else if (
      antigo.convocados_geral !== novo.convocados_geral ||
      antigo.convocados_negros !== novo.convocados_negros ||
      antigo.convocados_deficiencia !== novo.convocados_deficiencia
    ) {
      changes.push({ ...novo, tipo: 'alterado', anterior_geral: antigo.convocados_geral, anterior_negros: antigo.convocados_negros });
    }
  }
  return changes;
}

function buildEmailBody(results, changes) {
  let body = `=== MONITOR DE CONCURSOS UNICAMP ===\n\n`;
  body += `Data/Hora: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n\n`;

  for (const r of results) {
    const change = changes.find(c => c.numero === r.numero);
    body += `Concurso ${r.numero}\n`;
    body += `Área: ${r.area}\n`;
    body += `Cargo: ${r.cargo}\n`;
    body += `Lista geral: ${r.convocados_geral === -1 ? 'n/d' : `convocados até ${r.convocados_geral}`}\n`;
    body += `Lista negros: ${r.convocados_negros === -1 ? 'n/d' : `convocados até ${r.convocados_negros}`}\n`;
    if (r.convocados_deficiencia !== -1) {
      body += `Lista deficiência: ${r.convocados_deficiencia === 0 ? 'nenhum convocado' : `convocados até ${r.convocados_deficiencia}`}\n`;
    }
    if (change && change.tipo === 'alterado') {
      body += `⚠️ ALTERAÇÃO DETECTADA! Anterior: geral ${change.anterior_geral === -1 ? 'n/d' : change.anterior_geral}`;
      if (change.anterior_negros !== undefined) {
        body += `, negros ${change.anterior_negros === -1 ? 'n/d' : change.anterior_negros}`;
      }
      body += '\n';
    } else if (change && change.tipo === 'novo') {
      body += `🆕 Novo concurso monitorado\n`;
    }
    body += '\n';
  }

  body += `---\nMonitor automático - UNICAMP\nExecução: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
  return body;
}

async function sendEmail(body, isTest = false) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });

  const subject = isTest ? '[TESTE] ' + SUBJECT : SUBJECT;

  await transporter.sendMail({
    from: `"Monitor UNICAMP" <${EMAIL_FROM}>`,
    to: EMAIL_TO,
    subject,
    text: body,
  });
  console.log(`Email enviado para ${EMAIL_TO}`);
}

async function scrapeConcursos() {
  console.log('Iniciando navegador...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'pt-BR' });
  const page = await context.newPage();

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  console.log('Página carregada.');

  const allFound = [];
  let pageNum = 1;
  const MAX_PAGES = 30;

  while (allFound.length < TARGET_CONTESTS.length && pageNum <= MAX_PAGES) {
    console.log(`Verificando página ${pageNum}...`);
    await page.waitForSelector('.panelInscricoesAbertasInterno', { timeout: 15000 });

    const cards = await extractFromPage(page);
    const matches = matchTargets(cards);

    for (const m of matches) {
      if (!allFound.find(f => f.numero === m.numero)) {
        allFound.push(m);
        console.log(`  ✓ ${m.numero} - ${m.cargo}: geral até ${m.convocados_geral}, negros até ${m.convocados_negros !== -1 ? m.convocados_negros : 'n/a'}`);
      }
    }

    if (allFound.length < TARGET_CONTESTS.length) {
      const hasNext = await page.evaluate((currentPage) => {
        const inactives = document.querySelectorAll('td.rich-datascr-inact');
        for (const td of inactives) {
          const num = parseInt(td.textContent.trim());
          if (!isNaN(num) && num > currentPage) {
            td.click();
            return true;
          }
        }
        return false;
      }, pageNum);

      if (!hasNext) {
        console.log('Última página atingida.');
        break;
      }
      await page.waitForTimeout(3000);
      pageNum++;
    }
  }

  await browser.close();
  return allFound;
}

async function sendTestEmail() {
  const body = `=== EMAIL DE TESTE ===\n\nSe você recebeu este email, o sistema de notificação do Monitor de Concursos UNICAMP está funcionando corretamente.\n\nData/Hora: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n\n---\nMonitor automático - UNICAMP`;
  await sendEmail(body, true);
  console.log('Email de teste enviado com sucesso!');
}

async function run() {
  console.log('=== MONITOR DE CONCURSOS UNICAMP ===\n');

  const results = await scrapeConcursos();

  if (results.length === 0) {
    console.log('\nNenhum concurso alvo encontrado nas páginas.');
    console.log('Possíveis causas: os concursos podem ter sido removidos ou movidos para outra seção.');
    return;
  }

  const oldState = loadState();
  const changes = compareState(oldState, results);
  saveState(results);

  console.log(`\nConcursos monitorados: ${results.length}/${TARGET_CONTESTS.length}`);
  for (const r of results) {
    console.log(`  ${r.numero} - ${r.cargo}: geral ${r.convocados_geral !== -1 ? r.convocados_geral : 'n/d'}`);
  }

  if (changes.length > 0) {
    console.log('\n⚠️ Alterações detectadas! Enviando notificação por email...');
    const body = buildEmailBody(results, changes);
    await sendEmail(body);
  } else {
    console.log('\nNenhuma alteração desde a última verificação. Email não enviado.');
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--test')) {
    await sendTestEmail();
    return;
  }

  if (args.includes('--daemon')) {
    const interval = parseInt(process.env.CHECK_INTERVAL || '240', 10) * 60 * 1000;
    console.log(`Modo daemon: executando a cada ${interval / 60000} minutos\n`);
    while (true) {
      try {
        await run();
      } catch (err) {
        console.error('Erro na execução:', err.message);
      }
      console.log(`\nAguardando ${interval / 60000} minutos até a próxima verificação...\n`);
      await sleep(interval);
    }
  }

  await run();
}

main().catch(err => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
