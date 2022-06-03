const CathookConsole = require('./cpanel');
const express = require('express');
const bodyparser = require('body-parser');
const path = require('path');
const { Forever } = require('./forever/app');
const fs = require('fs');
const stoppable = require("stoppable");

const PORT = 8081;

const npid = require('npid');
try {
    const pid = npid.create('/tmp/ncat-cathook-webpanel.pid', true);
    pid.removeOnExit();
}
catch (error) {
    process.exit(1);
}

const app = express();

const session = require('express-session');

app.use(session({
    secret: require('randomstring').generate(16),
    resave: false,
    saveUninitialized: false
}))

app.use(express.static(path.join(__dirname, "wpanel")));
app.use(bodyparser.json());
app.use(bodyparser.urlencoded({ extended: true }));

const SimpleAuth = require('./auth');
const basicAuth = new SimpleAuth(app);
console.log('Login with password', basicAuth.password);
fs.writeFileSync('/tmp/cat-webpanel-password', basicAuth.password);

const cc = new CathookConsole();

var forever = new Forever(app, cc);

cc.once('init', () => {
    cc.command('connect');
});
cc.on('exit', () => { });

app.post('/api/direct/:command', function (req, res) {
    cc.command(req.params.command, req.body, function (data) {
        res.send(data);
    });
});

var server = app.listen(PORT, function () {
});
// For some reason nodejs thinks keep-alive connections should keep the http server alive. What the fuck.
stoppable(server, 0);


// epic sauce lock remover
const sauce_watcher = fs.watch('/tmp', (eventType, filename) => {
    if (filename === "source_engine_2925226592.lock" && fs.existsSync(`/tmp/${filename}`))
    {
        try
        {
            fs.unlinkSync(`/tmp/${filename}`);
        }
        catch (err)
        {

        }
    }
})

process.on("SIGINT", function () {
    server.stop();
    forever.stop();
    cc.stop();
    sauce_watcher.close();
});