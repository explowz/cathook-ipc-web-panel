const fs = require('fs');
const timestamp = require('time-stamp');

module.exports = {
    get: function get(index) {
        try {
            var accounts = fs.readFileSync("../accounts.txt", 'utf8');
            accounts = accounts.trim();
            let data_array = accounts.split(/\r\n|\r|\n|:/g);
            let account_array = [];
            for (let i = 0; i < data_array.length / 2; i++)
                account_array.push({ login: data_array[i * 2], password: data_array[i * 2 + 1] });
            if (index >= account_array.length)
            {
                return null;
            }
            return account_array[index];
        }
        catch (error) {
            process.exit(1);
        }
    }
}

// module for account