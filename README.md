# Monitor de Concursos UNICAMP

Script automatizado que monitora concursos públicos finalizados da **UNICAMP** (Portal SIARH) e envia alertas por email quando há alteração na classificação dos candidatos convocados.

## Funcionalidades

- Extrai dados da página 2 (e seguintes) do portal de concursos encerrados
- Detecta alterações no número de **convocados até a classificação** (lista geral, negros e deficiência)
- Envia email de alerta via **Gmail SMTP** apenas quando detecta mudança
- Agendamento a cada **4 horas** via Windows Task Scheduler

## Como usar

### 1. Clonar e instalar

```bash
npm install
npx playwright install chromium
```

### 2. Configurar credenciais

Copie o arquivo de exemplo e preencha com seus dados:

```bash
cp .env.example .env
```

Edite o `.env`:

```env
EMAIL_USER=seuemail@gmail.com
EMAIL_PASS=aaaa bbbb cccc dddd
EMAIL_TO=seuemail@gmail.com
EMAIL_FROM=seuemail@gmail.com
ALERT_SUBJECT=[ALERTA] Atualização na Lista de Concursos UNICAMP
```

> **Senha de app Gmail**: ative 2FA em `myaccount.google.com/security` e gere uma senha de app em `myaccount.google.com/apppasswords`.

### 3. Configurar quais concursos monitorar

Edite o array `TARGET_CONTESTS` no início do arquivo `monitor-concursos.js`:

```javascript
const TARGET_CONTESTS = [
  { id: '123/2022', area: 'PR TECNOLOGIA INFO COM', cargo: 'Administrador de redes' },
  { id: '125/2022', area: 'PR TECNOLOGIA INFO COM', cargo: 'Analista de suporte computacional' },
  { id: '24/2024', area: 'PR ARTE CULT COMUNICACAO', cargo: 'Técnico em multimeios didáticos' },
];
```

| Campo | O que é | Onde encontrar |
|-------|---------|----------------|
| `id` | Número do concurso | Título na página: `Concurso 24/2024` → `24/2024` |
| `area` | Área de atuação | Título: `PR TECNOLOGIA INFO COM / Cargo` |
| `cargo` | Nome do cargo | Título: `Área / Administrador de redes` |

### 4. Testar o envio de email

```bash
node monitor-concursos.js --test
```

### 5. Executar scraping completo

```bash
node monitor-concursos.js
```

Na primeira execução, cria o arquivo `dados-concursos.json` com o snapshot atual. Execuções seguintes comparam com esse snapshot e só enviam email se houver alteração.

## Agendamento automático (Windows)

A tarefa já foi criada via PowerShell:

```powershell
$action = New-ScheduledTaskAction -Execute "C:\Program Files\nodejs\node.exe" `
  -Argument "C:\caminho\monitor-concursos.js" `
  -WorkingDirectory "C:\caminho"
$trigger = New-ScheduledTaskTrigger -Once -At "00:00" `
  -RepetitionInterval (New-TimeSpan -Hours 4) `
  -RepetitionDuration (New-TimeSpan -Days 365)
Register-ScheduledTask -TaskName "MonitorConcursosUNICAMP" `
  -Action $action -Trigger $trigger -User "$env:USERNAME" -Force
```

Para verificar no Windows: **Task Scheduler** → `MonitorConcursosUNICAMP`.

## Agendamento automático (Linux/cron)

```bash
crontab -e
# Adicionar:
0 */4 * * * cd /caminho/do/projeto && /usr/bin/node monitor-concursos.js >> logs.txt 2>&1
```

## Migração para Ubuntu Server VPS

```bash
# Instalar Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Setup do projeto
git clone <seu-repo>
cd monitor-unicamp
npm install
npx playwright install --with-deps chromium

# Configurar .env
cp .env.example .env
nano .env

# Agendar via cron
crontab -e
# 0 */4 * * * cd /caminho && node monitor-concursos.js >> logs.txt 2>&1
```

## Estrutura do projeto

```
monitor-unicamp/
├── monitor-concursos.js   → Script principal
├── .env                   → Credenciais (ignorado pelo git)
├── .env.example           → Template de configuração
├── .gitignore             → Arquivos ignorados
├── dados-concursos.json   → Snapshot para comparação
├── package.json
└── README.md
```

## Como funciona o monitoramento

1. Playwright abre o navegador Chromium em modo headless
2. Acessa `https://www.siarh.unicamp.br/concurso/ConcursosEncerrados.jsf`
3. Navega pelas páginas até encontrar os concursos configurados
4. Extrai: `Candidatos da lista final geral: convocados até a classificação X`
5. Compara com o snapshot anterior (`dados-concursos.json`)
6. Se mudou → salva novo snapshot + envia email com detalhes da alteração
7. Se igual → apenas registra log, não envia email

## Tecnologias

- **Node.js** v22+
- **Playwright** (Chromium headless)
- **Nodemailer** (Gmail SMTP)
- **dotenv** (variáveis de ambiente)
