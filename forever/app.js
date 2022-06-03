const BotManager = require('./botmanager');
const config = require('./config');

let manager = null;

class app {
    constructor(app, cc) {
        if (process.getuid() !== 0) {
            process.exit(1);
        }
        if (manager) {
            process.exit(1);
        } else {
            manager = new BotManager(cc);
        }

        this.manager = manager;

        app.post('/api/config/:option/:value', (req, res) => {
            if (!config.hasOwnProperty(req.params.option))
                res.status(404).end();
            else {
                config[req.params.option] = req.params.value;
                res.status(200).end('' + config[req.params.option]);
            }
        });
        app.get('/api/config/:option', (req, res) => {
            if (!config.hasOwnProperty(req.params.option))
                res.status(404).end();
            else
                res.status(200).end('' + config[req.params.option]);
        });

        app.get('/api/list', function (req, res) {
            const result = {};
            result.quota = manager.quota;
            result.count = manager.bots.length;
            result.bots = {};
            for (const i of manager.bots) {
                result.bots[i.name] = {
                    user: i.user
                };
            }
            res.send(result);
        });

        app.get('/api/state', function (req, res) {
            const result = {bots: {}};
            for (const i of manager.bots) {
                result.bots[i.name] = {
                    ipc: i.ipcState,
                    restarts: i.restarts,
                    ipcID: i.ipcID,
                    state: i.state,
                    started: i.gameStarted,
                    pid: i.game
                };
            }
            res.send(result);
        });

        app.get('/api/bot/:bot/restart', function (req, res) {
            let bot;
            if (req.params.bot === "all") {
                for (bot of manager.bots)
                    bot.restart();
                res.status(200).end();
                return;
            }
            bot = manager.bot(req.params.bot);
            if (bot) {
                bot.restart();
                res.status(200).end();
            } else {
                res.status(400).send({
                    'error': 'Bot does not exist'
                })
            }
        });

        app.get('/api/bot/:bot/terminate', function (req, res) {
            let bot;
            if (req.params.bot === "all") {
                for (bot of manager.bots)
                    bot.stop();
                res.status(200).end();
                return;
            }
            bot = manager.bot(req.params.bot);
            if (bot) {
                bot.stop();
                res.status(200).end();
            } else {
                res.status(400).send({
                    'error': 'Bot does not exist'
                })
            }
        });

        app.get('/api/quota/:quota', function (req, res) {
            manager.setQuota(req.params.quota);
            res.send({
                quota: manager.quota
            });
        });
    }

    stop() {
        this.manager.stop();
    }
}

exports.Forever = app;

// module for bots