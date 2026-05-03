const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './data/wa_auth' }),
    puppeteer: { executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] }
});

client.on('ready', async () => {
    console.log('Client is ready!');
    const lid = '182364311425240@lid';
    const c = await client.getContactById(lid).catch(()=>null);
    console.log('Using wwebjs getContact:', c ? c.name : 'null');
    
    // Check recent chats to see their IDs
    const chats = await client.getChats();
    const claroChat = chats.find(ch => ch.id._serialized.includes('182') || (ch.name && ch.name.toLowerCase().includes('claro')));
    if (claroChat) {
        console.log('Found Claro chat!', claroChat.id._serialized);
        const contact = await claroChat.getContact();
        console.log('Claro contact:', { name: contact.name, pushname: contact.pushname, number: contact.number });
    }
    
    const data = await client.pupPage.evaluate(async () => {
        const w = window;
        const contacts = w.Store.Contact.getModelsArray();
        const lids = contacts.filter(c => c.id && c.id.server === 'lid');
        return lids.slice(0, 3).map(c => ({
            id: c.id._serialized,
            name: c.name,
            pushname: c.pushname,
            displayName: c.displayName,
            phoneNumber: c.phoneNumber,
			userid: c.userid,
            verifiedName: c.verifiedName
        }));
    });
    console.log('Evaluating LIDs:', data);
    process.exit(0);
});

client.initialize();
