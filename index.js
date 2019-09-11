const express = require('express')
const WebSocket = require('ws')
const ccxt = require('ccxt')
const bitmex = new ccxt.bitmex()

// 1. set paths
// 2. set all symbols
// 3. setup api
// 4. get all bars history
// 5. setup websocket for bar updates


// 1. paths:
//
//  data[] starts each different content item you want to calculate and serve.
//  the first item in the array is for the candlesticks, with
//  `bars = {}` being the data holder, then the strings array is the different paths.
//
data = [
    [bars = {}, ['m1', 'm5', 'h1', 'd1']],
    [testPaths = {}, ['random', 'somepath']],
]

// the bars paths are updated with every websocket trade.  you can update other paths from there also,
// or calculate/update them however you want.

// the `random` path would be [localhost:3001 or server url]/XBTUSD/random, for each symbol, this will update it every second.
setInterval(() => {
    symbols.forEach((symbol)=>{
        data[1][0][symbol]['random'] = Math.random().toFixed(5)
    })
}, 1000)


// 2. symbols:
//
//   this string determines the path name, although CCXT requires wierd names sometimes.
//   use getCCXTsymbol() at the bottom to set the names for ccxt data pulls
//
symbols = [
    'XBTUSD',
    // 'ETHUSD',
    // 'XBTM19','XBTU19','ETHM19','ADAM19','BCHM19',
    // 'EOSM19','LTCM19','TRXM19','EOSM19','XRPM19'
]

// how much OHLC history to store for each timeframe
barCount = 2000


// 3. express server
//
const setupDataAPI = (() => {

    // make a path for each symbol+datapath (eg. bars.XBTUSD.m1)
    data.forEach(d => {
        (d[2] || symbols).forEach(s => {
            d[0][s] = {}
            d[1].forEach(p => d[0][s][p] = ['[' + s + ':' + p + ']'])
        })
    })

    // setup api server so we can add some endpoints
    const app = express()
    app.get('/', (req, res) => res.send('example path: /XBTUSD/m1'))
    app.listen(process.env.PORT || 3001)

    // set paths, ex. GET /XBTUSD/m1
    data.forEach(d => ((data, paths) =>
        Object.keys(data).forEach(key => {
            paths.forEach(p => app.get('/' + key + '/' + p, (req, res) => res.send(data[key][p] || data[key])))
        }))(d[0], d[1]))
})()


// 4. get history with CCXT.  need to optimize time between api calls (get ratelimit from incoming headers)
//
const getAllBars = (() => {

    const get = async (symbol, bin) => {
        console.log("getting " + symbol + bin)
        await new Promise(resolve => setTimeout(resolve, 5000))
        console.log(symbol + bin + 'pull 1')
        let bars1 = await bitmex.fetchOHLCV(getCCXTsymbol(symbol), bin[1] + bin[0], null, 750, {reverse: true})

        for (let i = 0; i < Math.ceil(barCount / 750); i++) {
            await new Promise(resolve => setTimeout(resolve, 5000))
            console.log(symbol + bin + 'pull ' + (i + 2))
            let bars2 = await bitmex.fetchOHLCV(getCCXTsymbol(symbol), bin[1] + bin[0], null, 750, {
                reverse: true, partial: true, endTime: new Date(bars1[0][0]).toISOString().split('.')[0] + "Z"
            })
            bars1 = bars2.concat(bars1)
        }
        bars[symbol][bin] = bars1
    }

    symbols.forEach(async (symbol, i) => {
        await new Promise(resolve => setTimeout(resolve, ((barCount / 1000) * 40000) * i))
        for (let j = 0; j < 4; j++) {
            await get(symbol, data[0][1][j])
        }
    })

})()

// 5.  websocket for updates
//
const setupBitmexWebsocket = (async () => {

    const socketOpenListener = e => console.log('bitmex ws open')
    const socketCloseListener = e => {
        if (this.socket) {
            console.error('bitmex ws close')
        }
        this.socket = new WebSocket('wss://www.bitmex.com/realtime?subscribe=trade')
        this.socket.addEventListener('open', socketOpenListener)
        this.socket.addEventListener('message', socketMessageListener)
        this.socket.addEventListener('close', socketCloseListener)
    }
    const socketMessageListener = e => {
        let msg = JSON.parse(e.data)

        if (msg.table === 'trade') {
            tradeMsg(msg.action, msg.data)
        }
    }
    const tradeMsg = (action, tradeData) => {

        if (!symbols.find(s => s === tradeData[0].symbol)) return

        let total = 0
        tradeData.forEach(t => total += t.size)
        let price = tradeData[tradeData.length - 1].price

        const setBars = data[0][1].forEach(bin => setBar(tradeData[0].symbol, bin))

        async function setBar(symbol, bin) {

            let bars = data[0][0][symbol][bin]
            let currentBar = bars[bars.length - 1]
            let lastbarTime = currentBar[0]
            let time = new Date(tradeData[0].timestamp).getTime()

            if (time < lastbarTime) {
                //update current bar
                let currentBar = bars[bars.length - 1]
                currentBar[4] = price
                currentBar[5] += total

                if (price > currentBar[2]) {
                    currentBar[2] = price
                } else if (price < currentBar[3]) {
                    currentBar[3] = price
                }
            } else {
                //make new bar with this trade and last time + time
                let bars_ = bars
                let close = bars_[bars_.length - 1][4]
                bars_.push([lastbarTime + (bin === 'm1' ? 60000 : bin === 'm5' ? 300000 : bin === 'h1' ? 3600000 : 86400000), close, close, close, close, 0])
                bars_.shift()
            }
        }
    }
    socketCloseListener()
})()

const getCCXTsymbol = (symbol) => {
    //mex pairs
    if (symbol === 'XBTUSD') {
        return 'BTC/USD'
    } else if (symbol === 'ETHUSD') {
        return 'ETH/USD'
    } else if (symbol.includes('M19')) {
        return symbol.replace('M19', 'M19')
    } else if (symbol.includes('U19')) {
        return symbol.replace('U19', 'U19')
    }

    //binance pairs

    if (symbol.includes('BTC')) {
        return symbol.replace('BTC', '/BTC')
    } else if (symbol.includes('USDT')) {
        return symbol.replace('USDT', '/USDT')
    }
    return symbol
}

const sleep = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms))
}
