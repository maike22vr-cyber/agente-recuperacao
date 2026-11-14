require('dotenv').config({ path: './tokens.env' });
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const {
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  GROK_API_KEY,
  VERIFY_TOKEN,
  PORT = 3000
} = process.env;

const conversations = new Map();
const compradores = new Set(); // telefones que já compraram

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (message && message.type === 'text') {
    const from = message.from;
    const text = message.text.body;
    const reply = await askGrok(from, text);
    await sendWhatsApp(from, reply);
  }
  res.sendStatus(200);
});

app.post('/hubla', async (req, res) => {
  const event = req.body;
  const type = event.type || event.event?.type;
  const phone = (event.event?.lead?.phone || event.lead?.phone || event.event?.customer?.phone || '').replace(/\D/g, '');
  const name = event.event?.lead?.fullName || event.lead?.fullName || event.event?.customer?.name || 'Cliente';

  if (!phone) return res.sendStatus(200);

  // Se pagou, marca como comprador
  if (type === 'invoice.payment_succeeded') {
    compradores.add(phone);
    console.log(`Comprador marcado: ${phone}`);
    return res.sendStatus(200);
  }

  // Se já comprou, não manda recuperação
  if (compradores.has(phone)) {
    console.log(`Já comprou, ignorando: ${phone}`);
    return res.sendStatus(200);
  }

  // Eventos de recuperação
  if (['invoice.payment_failed', 'invoice.expired', 'invoice.refunded', 'refund_request.created'].includes(type)) {
    setTimeout(async () => {
      if (compradores.has(phone)) return; // confere de novo depois do delay
      let msg = `Oi ${name}! Vi que teve um problema com o pagamento. Posso te ajudar a finalizar?`;
      if (type === 'invoice.refunded' || type === 'refund_request.created') {
        msg = `Oi ${name}! Vi sua solicitação de reembolso. Posso te ajudar com alguma dúvida?`;
      }
      await sendWhatsApp(phone, msg);
    }, 5 * 60 * 1000);
  }

  res.sendStatus(200);
});

async function askGrok(userId, userMessage) {
  const history = conversations.get(userId) || [];
  history.push({ role: 'user', content: userMessage });

  try {
    const response = await axios.post(
      'https://api.x.ai/v1/chat/completions',
      {
        model: 'grok-2-latest',
        messages: [
          { role: 'system', content: 'Você é um assistente de recuperação de vendas. Seja educado e ajude o cliente. Responda em português.' },
          ...history.slice(-6)
        ],
        max_tokens: 300
      },
      { headers: { Authorization: `Bearer ${GROK_API_KEY}` } }
    );
    const reply = response.data.choices[0].message.content;
    history.push({ role: 'assistant', content: reply });
    conversations.set(userId, history);
    return reply;
  } catch (err) {
    return 'Desculpe, tive um problema. Pode repetir?';
  }
}

async function sendWhatsApp(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
  } catch (err) {
    console.error('Erro WhatsApp:', err.response?.data || err.message);
  }
}

app.get('/', (req, res) => res.send('Agente rodando!'));
app.listen(PORT, () => console.log(`Servidor na porta ${PORT}`));
