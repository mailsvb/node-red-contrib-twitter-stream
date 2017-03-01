const http = require('http');

module.exports = function(RED) {
    "use strict";
    const util = require('util');
    const Twit = require('twit');

    var clients = {};

    // handle the connection to the Twitter API
    function TwitterAPIConnection(n) {
        RED.nodes.createNode(this,n);
        var node = this;
        node.consumerKey = n.consumerKey;
        node.consumerSecret = n.consumerSecret;
        node.accessToken = n.accessToken;
        node.accessSecret = n.accessSecret;

        var id = node.consumerKey;

        node.log('create new Twitter instance for: ' + id);
        
        clients[id] = new Twit({
            consumer_key: node.consumerKey,
            consumer_secret: node.consumerSecret,
            access_token: node.accessToken,
            access_token_secret: node.accessSecret
        });
        
        node.client = clients[id];

        this.on("close", function() {
            node.log('delete Twitter instance on close event');
            delete clients[id];
        });
    }
    RED.nodes.registerType("twitter-api-connection",TwitterAPIConnection);
    
    //Twitter stream
    function TwitterStream(n) {
        RED.nodes.createNode(this,n);
        var node = this;
        node.follow = n.follow || "";
        node.topics = n.topics || "";
        node.tweetLimit = parseInt(n.tweetLimit) || 0;
        node.onlyVerified = n.onlyVerified || false;
        node.topicRetweets = n.topicRetweets || false;
        node.topicLanguage = n.topicLanguage.toString().trim().split(",") || ['en','de'];
        node.loadImages = n.loadImages || false;
        node.debug = n.debug || false;
        node.waitForUserLookup = false;
        node.userNames = [];
        node.userIDs = [];
        node.streamOptions = {};
        node.tweetCount = 0;
        node.connection = RED.nodes.getNode(n.connection);
        node.status({fill:"yellow",shape:"dot",text:"connecting"});
        
        if (node.topics !== "") {
            node.streamOptions.track = node.topics;
        }
        
        if (node.follow !== "") {
            node.waitForUserLookup = true;
            node.connection.client.get('users/lookup', {screen_name: node.follow}, function(error, data, response){
                if (error) {
                    node.status({fill:"yellow",shape:"dot",text:"error user/lookup"});
                    node.error(util.inspect(error, { showHidden: true, depth: null }));
                }
                try {
                    for (var i=0; i < data.length; i++)
                    {
                        node.userIDs.push(data[i].id_str.toString());
                        node.userNames.push(data[i].name.toString());
                    }
                    node.streamOptions.follow = node.userIDs.join(',').toString();
                    node.log('streaming IDs: ' + node.streamOptions.follow);
                    node.log('streaming Names: ' + node.userNames.join(',').toString());
                }
                catch (error) {
                    node.error(util.inspect(error, { showHidden: true, depth: null }));
                }
                node.waitForUserLookup = false;
            });
        }
        
        let startInterval = setInterval(() => {
            if (node.waitForUserLookup === false) {
                node.stream = node.connection.client.stream('statuses/filter', node.streamOptions);
                node.stream.on('connect', function (request) {
                    node.log('streaming API connecting');
                    node.status({fill:"yellow",shape:"dot",text:"connecting"});
                });
                
                node.stream.on('connected', function (response) {
                    node.log('streaming API connected ' + util.inspect(node.streamOptions, { showHidden: true, depth: null }));
                    node.status({fill:"green",shape:"dot",text:"connected"});
                });
                
                node.stream.on('disconnect', function (disconnectMessage) {
                    node.log('streaming API disconnected ' + util.inspect(disconnectMessage, { showHidden: true, depth: null }));
                    node.status({fill:"red",shape:"dot",text:"disconnected"});
                });
                
                node.stream.on('reconnect', function (request, response, connectInterval) {
                    node.log('streaming API reconnecting');
                    node.status({fill:"yellow",shape:"dot",text:"reconnecting"});
                });
                    
                node.stream.on('tweet', function(tweet) {
                    
                    (node.debug === true) ? node.log(util.inspect(tweet, { showHidden: true, depth: null })) : node.log(tweet.user.name + ': ' + tweet.text);
                    
                    // if followed user, immediatelly send tweet
                    if (node.userIDs.indexOf(tweet.user.id_str) >= 0) {
                        asyncLoadAndSend(node.loadImages, tweet, (tweet) => { node.send({payload: tweet}); });
                        return;
                    }
                    
                    // if non requested language, drop tweet
                    if (node.topicLanguage.indexOf(tweet.lang) < 0) {
                        node.log('skip: language https://twitter.com/statuses/' + tweet.id_str);
                        return;
                    }
                    
                    // if onlyVerified and user is not a verified user, drop tweet
                    if (node.onlyVerified === true && tweet.user.verified === false) {
                        node.log('skip: unverified account https://twitter.com/statuses/' + tweet.id_str);
                        return;
                    }
                    
                    // if we reached the tweet limit per minute, drop tweet
                    if (node.tweetLimit > 0 && (node.tweetCount >= node.tweetLimit)) {
                        node.log('skip: tweet limit https://twitter.com/statuses/' + tweet.id_str);
                        return;
                    }
                    
                    // if no RT are allowed and tweet is a retweet, drop tweet
                    if (node.topicRetweets === false && tweet.retweeted_status) {
                        node.log('skip: retweet https://twitter.com/statuses/' + tweet.id_str);
                        return;
                    }
                    
                    node.tweetLimitCount += 1;
                    setTimeout(() => {
                        node.tweetLimitCount -= 1;
                    }, (60000 - ((Math.floor(Math.random() * 10) + 1) * 1000)));
                    asyncLoadAndSend(node.loadImages, tweet, (tweet) => { node.send({payload: tweet}); });
                });
                clearInterval(startInterval);
            }
        }, 100);

        this.on("close", function() {
            if (node.stream) {
                node.log('stopping stream on close');
                node.stream.stop();
                delete node.stream;
            }
        });
    }
    RED.nodes.registerType("Twitter Stream",TwitterStream);
};

const asyncLoadAndSend = (getImages, tweet, cb) => {
    if (getImages === true && tweet.entities && tweet.entities.media) {
        let run = 0;
        for (var i=0; i < tweet.entities.media.length; i++) {
            (function(tweet, i) {
                http.get(tweet.entities.media[i].media_url, (res) => {
                    let data = [];
                    res.on('data', (chunk) => data.push(chunk));
                    res.on('end', () => { 
                        run++;
                        tweet.entities.media[i].buffer = Buffer.concat(data);
                        if (run == tweet.entities.media.length) {
                            cb(tweet);
                        }
                    });
                });
            })(tweet, i);
        }
    }
    else {
        cb(tweet);
    }
};
