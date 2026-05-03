const { Client, LocalAuth } = require('whatsapp-web.js');

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './data/wa_auth' }),
    puppeteer: { executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] }
});

client.on('ready', async () => {
    console.log('Client is ready!');
    const lidJid = '182364311425240@lid';
    
    const realPhone = await client.pupPage.evaluate(async (lidJid) => {
          try {
            const w = window;
            if (w.Store && w.Store.Contact) {
              const all = w.Store.Contact.getModelsArray();
              // First approach: try lidJid in c.us contact
              let real = all.find(c => c.id && c.id.server === 'c.us' && c.lidJid && c.lidJid.split('@')[0] === lidJid.split('@')[0]);
              
              if (!real) {
                  // Second approach: get the lid contact itself and check phoneNumber
                  const lidContact = w.Store.Contact.get(lidJid);
                  if (lidContact && lidContact.phoneNumber) {
                      return lidContact.phoneNumber.split('@')[0];
                  }
              }
              
              return real?.id?.user ?? null;
            }
          } catch(e) {}
          return null;
    }, lidJid);
    
    console.log("realPhone =", realPhone);
    process.exit(0);
});

client.initialize();
