const fs = require('fs');
const Bot = require('./bot');

class BotManager {
    constructor(cc) {
        const self = this;
        try {
            fs.mkdirSync('network/wpanel-network/wpanel-logs');
        } catch (e) {
        }
        this.bots = [];
        this.cc = cc;
        this.quota = 0;
        this.wanted_quota = 0;
        this.lastQuery = {};
        this.updateTimeout = setTimeout(this.update.bind(this), 1000);
        this.stopping = false;
    }

    update() {
        const self = this;
        Bot.currentlyStartingGames = 0;

        this.enforceQuota();

        for (let i = self.bots.length - 1; i >= 0; i--) {
            const b = self.bots[i];
            if (b.state === Bot.states.STARTING || b.state === Bot.states.WAITING)
                Bot.currentlyStartingGames++;
            if (i + 1 > this.quota && b.full_stop()) {
                self.bots.splice(i, 1);
            } else
                b.update();
        }

        if (!this.stopping)
            self.cc.command('query', {}, function (data) {
                self.updateTimeout = setTimeout(self.update.bind(self), 1000);
                self.lastQuery = data;
                for (const q in data.result) {
                    for (const b of self.bots) {
                        if (b.startTime && b.startTime === data.result[q].starttime) {
                            b.emit('ipc-data', {
                                id: q,
                                data: data.result[q]
                            })
                        }
                    }
                }
            });
        else if (self.bots.length)
            self.updateTimeout = setTimeout(self.update.bind(self), 1000);
    }

    enforceQuota() {
        if (this.bots.length === this.quota)
            this.quota = this.wanted_quota;
        while (this.bots.length < this.quota) {
            this.bots.push(new Bot.bot(this.bots.length));
        }
    }

    bot(name) {
        for (const bot of this.bots) {
            if (bot.name === name) return bot;
        }
        return null;
    }

    setQuota(quota) {
        quota = parseInt(quota);
        if (!isFinite(quota) || isNaN(quota)) {
            return;
        }
        this.wanted_quota = quota;
        this.enforceQuota();
    }

    stop() {
        this.setQuota(0);
        this.stopping = true;
    }
}

module.exports = BotManager;
