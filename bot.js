const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const matches = new Map();

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        // executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        executablePath: '/usr/bin/chromium', // PROD
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

// Classe pour gérer les matchs
class Match {
    constructor(id, creator, date, time, chatId) {
        this.id = id;
        this.creator = creator;
        this.date = date;
        this.time = time;
        this.participants = [creator];
        this.maxPlayers = 4;
        this.waitingList = [];
        this.chatId = chatId;
        this.status = 'open';
    }

    addParticipant(user) {
        if (this.participants.includes(user)) {
            return { success: false, message: "Tu es déjà inscrit !" };
        }
        
        if (this.participants.length < this.maxPlayers) {
            this.participants.push(user);
            if (this.participants.length === this.maxPlayers) {
                this.status = 'full';
            }
            return { success: true, message: "Inscrit au match !" };
        } else {
            if (!this.waitingList.includes(user)) {
                this.waitingList.push(user);
                return { success: true, message: "Ajouté à la liste d'attente" };
            }
            return { success: false, message: "Déjà en liste d'attente" };
        }
    }

    removeParticipant(user) {
        const index = this.participants.indexOf(user);
        if (index > -1) {
            this.participants.splice(index, 1);
            
            // Promouvoir quelqu'un de la liste d'attente
            if (this.waitingList.length > 0) {
                const promoted = this.waitingList.shift();
                this.participants.push(promoted);
                return { success: true, message: `${user} a quitté. ${promoted} a été promu !` };
            }
            
            this.status = 'open';
            return { success: true, message: `${user} a quitté le match` };
        }
        
        const waitIndex = this.waitingList.indexOf(user);
        if (waitIndex > -1) {
            this.waitingList.splice(waitIndex, 1);
            return { success: true, message: "Retiré de la liste d'attente" };
        }
        
        return { success: false, message: "Tu n'es pas inscrit à ce match" };
    }

    formatMessage() {
        let msg = `🎾 *MATCH PADEL*\n`;
        msg += `📅 ${this.date} à ${this.time}\n`;
        msg += `🆔 ID: ${this.id}\n\n`;
        msg += `👥 *Joueurs (${this.participants.length}/${this.maxPlayers}):*\n`;
        
        this.participants.forEach((p, i) => {
            msg += `${i + 1}. ${p}\n`;
        });
        
        for (let i = this.participants.length; i < this.maxPlayers; i++) {
            msg += `${i + 1}. _[place libre]_\n`;
        }
        
        if (this.waitingList.length > 0) {
            msg += `\n⏳ *Liste d'attente:*\n`;
            this.waitingList.forEach((p, i) => {
                msg += `${i + 1}. ${p}\n`;
            });
        }
        
        if (this.status === 'full') {
            msg += `\n✅ *COMPLET !*`;
        } else {
            msg += `\n💬 _Tape /rj ${this.id} pour participer_`;
        }
        
        return msg;
    }
}

// Gérer les messages reçus
client.on('message_create', async (msg) => {
    const chat = await msg.getChat();
    const contact = await msg.getContact();
    const sender = contact.pushname || contact.number;
    const command = msg.body.toLowerCase().trim();
    
    // Ignorer les messages non-commandes
    if (!command.startsWith('/')) return;
    
    console.log(`📨 Commande reçue de ${sender}: ${command}`);
    
    // === CRÉER UN MATCH ===
    if (command.startsWith('/padel')) {
        const parts = msg.body.split(' ').slice(1);
        
        if (parts.length < 2) {
            await msg.reply('❌ Format: /padel [date] [heure]\nExemple: /padel 12/08 18h');
            return;
        }
        
        const date = parts[0];
        const time = parts[1];
        const matchId = Date.now().toString().slice(-4);
        
        const match = new Match(matchId, sender, date, time, chat.id._serialized);
        matches.set(matchId, match);
        
        await msg.reply(match.formatMessage());
        console.log(`✅ Match ${matchId} créé par ${sender}`);
    }
    
    // === LISTE DES MATCHS ===
    else if (command === '/liste') {
        const chatMatches = Array.from(matches.values())
            .filter(m => m.chatId === chat.id._serialized && m.status !== 'cancelled');
        
        if (chatMatches.length === 0) {
            await msg.reply('📋 Aucun match programmé\n\n_Crée un match avec /padel [date] [heure]_');
            return;
        }
        
        let response = '📋 *MATCHS PROGRAMMÉS:*\n\n';
        chatMatches.forEach(match => {
            response += `• ${match.date} ${match.time} (${match.participants.length}/${match.maxPlayers})\n`;
            response += `  ID: ${match.id}\n\n`;
        });
        
        await msg.reply(response);
    }
    
    // === REJOINDRE UN MATCH ===
    else if (command.startsWith('/rj')) {
        const matchId = command.split(' ')[1];
        
        if (!matchId) {
            await msg.reply('❌ Format: /rj [ID]\nExemple: /rj 1234');
            return;
        }
        
        const match = matches.get(matchId);
        if (!match) {
            await msg.reply('❌ Match introuvable. Vérifie l\'ID ou tape /liste');
            return;
        }
        
        const result = match.addParticipant(sender);
        if (result.success) {
            await msg.reply(`✅ ${result.message}\n\n${match.formatMessage()}`);
        } else {
            await msg.reply(`❌ ${result.message}`);
        }
    }
    
    // === QUITTER UN MATCH ===
    else if (command.startsWith('/quitter')) {
        const matchId = command.split(' ')[1];
        
        if (!matchId) {
            await msg.reply('❌ Format: /quitter [ID]');
            return;
        }
        
        const match = matches.get(matchId);
        if (!match) {
            await msg.reply('❌ Match introuvable');
            return;
        }
        
        const result = match.removeParticipant(sender);
        if (result.success) {
            await msg.reply(`👋 ${result.message}\n\n${match.formatMessage()}`);
        } else {
            await msg.reply(`❌ ${result.message}`);
        }
    }
    
    // === ANNULER UN MATCH ===
    else if (command.startsWith('/annuler')) {
        const matchId = command.split(' ')[1];
        
        if (!matchId) {
            await msg.reply('❌ Format: /annuler [ID]');
            return;
        }
        
        const match = matches.get(matchId);
        if (!match) {
            await msg.reply('❌ Match introuvable');
            return;
        }
        
        if (match.creator !== sender) {
            await msg.reply('❌ Seul le créateur peut annuler le match');
            return;
        }
        
        matches.delete(matchId);
        await msg.reply(`❌ Match ${matchId} annulé par ${sender}`);
    }
    
    // === AIDE ===
    else if (command === '/aide' || command === '/help') {
        const help = `🎾 *BOT PADEL - COMMANDES*

/padel [JJ/MM] [heure] - Créer un match
/liste - Voir tous les matchs
/rj [ID] - Rejoindre un match  
/quitter [ID] - Quitter un match
/annuler [ID] - Annuler (créateur only)
/aide - Afficher cette aide

_Exemple: /padel 12/08 18h_`;
        
        await msg.reply(help);
    }
});

// Afficher le QR code pour se connecter
client.on('qr', (qr) => {
    console.log('📱 SCANNE CE QR CODE AVEC WHATSAPP:');
    console.log('');
    qrcode.generate(qr, { small: true });
    console.log('');
});

// Quand le bot est prêt
client.on('ready', () => {
    console.log('✅ Bot WhatsApp connecté et prêt !');
    console.log('');
    console.log('📝 Commandes disponibles:');
    console.log('  /padel [JJ/MM] [heure] - Créer un match');
    console.log('  /liste - Voir les matchs');
    console.log('  /rj [id] - Rejoindre un match');
    console.log('  /quitter [id] - Quitter un match');
    console.log('  /aide - Afficher l\'aide');
    console.log('');
    console.log('💬 Va dans un groupe WhatsApp et tape /aide pour commencer !');
});

// Gestion des erreurs
client.on('auth_failure', () => {
    console.error('❌ Erreur d\'authentification');
});

client.on('disconnected', (reason) => {
    console.log('🔌 Bot déconnecté:', reason);
    console.log('Redémarre avec: node bot.js');
});

client.on('loading_screen', (percent, message) => {
    console.log('⏳ Chargement:', percent, message);
});

console.log('🚀 Démarrage du bot WhatsApp...');

client.initialize().catch(err => {
    console.error('❌ Erreur au démarrage:', err);
});