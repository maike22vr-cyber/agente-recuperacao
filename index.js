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

// Armazena conversas simples em memória
const conversations = new Map();

// Mensagens iniciais aprovadas
const MENSAGENS = {
  abandonado: (nome) =>
    `Oi ${nome}, aqui é a Thais da equipe da Suellen.\n\nVi que sua compra ficou pela metade e tem um detalhe do pagamento que precisa de atenção.\n\nPrefere que eu te mande o link de novo ou prefere me contar o que aconteceu?`,

  cartao: (nome) =>
    `Oi ${nome}, aqui é a Thais da equipe da Suellen.\n\nVi que deu um problema no cartão na hora de finalizar.\n\nPrefere que eu gere um novo link ou prefere me dizer o que apareceu na tela?`,

  reembolso: (nome) =>
    `Oi ${nome}, aqui é a Thais da equipe da Suellen.\n\nSeu pedido de reembolso chegou aqui. Só preciso de uma confirmação rápida pra liberar.\n\nPode me confirmar por aqui?`
};

// Webhook verification (Meta)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verificado');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Recebe mensagens do WhatsApp
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (message && message.type === 'text') {
      const from = message.from;
      const text = message.text.body;

      console.log(`Mensagem de ${from}: ${text}`);

      const reply = await askGrok(from, text);
      await sendWhatsApp(from, reply);
    }
  }

  res.sendStatus(200);
});

// Webhook da Hubla
app.post('/hubla', async (req, res) => {
  const event = req.body;
  console.log('Evento Hubla:', event.type || event.event?.type);

  const type = event.type || event.event?.type;
  const phone = event.event?.lead?.phone || event.lead?.phone || event.event?.user?.phone;
  const name = event.event?.lead?.fullName || event.lead?.fullName || event.event?.user?.firstName || 'Cliente';

  if (!phone) {
    return res.sendStatus(200);
  }

  let mensagem = null;

  if (type === 'lead.abandoned_checkout') {
    mensagem = MENSAGENS.abandonado(name);
  } else if (type === 'invoice.payment_failed' || type === 'payment.failed') {
    mensagem = MENSAGENS.cartao(name);
  } else if (type === 'refund_request.created' || type === 'refund.created') {
    mensagem = MENSAGENS.reembolso(name);
  }

  if (mensagem) {
    setTimeout(async () => {
      await sendWhatsApp(phone.replace(/\D/g, ''), mensagem);
    }, 5 * 60 * 1000);
  }

  res.sendStatus(200);
});

// Endpoint de teste manual (não envia WhatsApp, só devolve a mensagem)
app.get('/teste', (req, res) => {
  const tipo = (req.query.tipo || 'abandonado').toLowerCase();
  const nome = req.query.nome || 'Maria';

  const fn = MENSAGENS[tipo] || MENSAGENS.abandonado;
  const mensagem = fn(nome);

  res.json({
    tipo,
    nome,
    mensagem
  });
});

// Endpoint de teste que simula resposta do Grok (sem enviar WhatsApp)
app.post('/teste-resposta', async (req, res) => {
  const { userId = 'teste', mensagem } = req.body;
  if (!mensagem) return res.status(400).json({ erro: 'mande a mensagem no body' });

  const reply = await askGrok(userId, mensagem);
  res.json({ userId, sua_mensagem: mensagem, resposta_thais: reply });
});

async function askGrok(userId, userMessage) {
  const history = conversations.get(userId) || [];
  history.push({ role: 'user', content: userMessage });

  try {
    const response = await axios.post(
      'https://api.x.ai/v1/chat/completions',
      {
        model: 'grok-3',
        messages: [
          {
            role: 'system',
            content: `Você é a Thais, da equipe da Suellen. Atua no WhatsApp recuperando vendas que não foram concluídas (carrinho abandonado, erro no cartão, PIX não pago, reembolso) e conduzindo a pessoa até a compra quando fizer sentido.

Você fala como alguém da equipe, próxima e humana. Não parece robô. Tem um tom um pouco mais afiado e direto, sem ser grosseira.

## Regras de formato (obrigatórias)
- Mensagens curtas. Máximo 2-3 linhas por mensagem.
- Uma ideia por mensagem.
- Se precisar falar mais, quebre em mensagens separadas com uma linha em branco entre elas.
- Uma pergunta por vez. Nunca duas na mesma mensagem.
- Não use travessão (—).
- Sem markdown (negrito, itálico, listas).
- Sem aberturas genéricas do tipo "Oi, tudo bem?" ou "Como posso ajudar?".
- Tom natural de WhatsApp real, português brasileiro informal.

## Como conduzir a conversa
Proximidade: Comece reconhecendo o nome da pessoa (quando souber) e o que aconteceu, de forma leve e direta. Faça ela se sentir ouvida.

Análise: Faça 1-2 perguntas estratégicas para entender o que travou (erro no cartão, dúvida, momento, etc.). Quem pergunta conduz.

Valor: Conecte o que a pessoa quase comprou com um benefício concreto para ela. Não fique só pedindo para "finalizar a compra".

Encerramento / ou-ou: Ofereça sempre duas opções positivas dentro do WhatsApp.

## Regras importantes
- Nunca chame para ligação.
- Nunca invente preço, bônus, prazo ou promessa.
- Se não souber algo, diga que vai verificar com a equipe da Suellen.
- Se a pessoa já comprou ou o reembolso já foi processado, não force venda. Seja prestativa.
- Se a pessoa insistir que pagou e você não tiver confirmação, diga que vai confirmar com a equipe e peça o e-mail para localizar.
- Responda sempre curto e direto.`
          },
          ...history.slice(-6)
        ],
        max_tokens: 300
      },
      {
        headers: {
          Authorization: `Bearer ${GROK_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const reply = response.data.choices[0].message.content;
    history.push({ role: 'assistant', content: reply });
    conversations.set(userId, history);
    return reply;
  } catch (err) {
    console.error('Erro Grok:', err.response?.data || err.message);
    return 'Desculpe, tive um problema. Pode repetir?';
  }
}

async function sendWhatsApp(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`Mensagem enviada para ${to}`);
  } catch (err) {
    console.error('Erro WhatsApp:', err.response?.data || err.message);
  }
}

app.get('/', (req, res) => {
  res.send('Agente de Recuperação rodando!');
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
