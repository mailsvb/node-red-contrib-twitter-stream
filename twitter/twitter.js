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
        })
        
        node.client = clients[id];

        this.on("close", function() {
            node.log('delete Twitter instance on close event');
            delete clients[id];
        });
    }
    RED.nodes.registerType("twitter-api-connection",TwitterAPIConnection);

    //Twitter stream of users
    function TwitterStreamUser(n) {
        RED.nodes.createNode(this,n);
        var node = this;
        node.follow = n.follow;
        node.connection = RED.nodes.getNode(n.connection);
        node.status({fill:"yellow",shape:"dot",text:"connecting"});
        
        node.connection.client.get('users/lookup', {screen_name: node.follow}, function(error, data, response){
            if (error) {
                node.status({fill:"red",shape:"dot",text:"error"});
                node.error(util.inspect(error, { showHidden: true, depth: null }));
                return;
            }
            try {
                var all_IDs = [];
                var all_names = [];
                for (var i=0; i < data.length; i++)
                {
                    all_IDs.push(data[i].id_str.toString());
                    all_names.push(data[i].name.toString());
                }
                node.log('streaming IDs: ' + all_IDs.join(', ').toString());
                
                node.stream = node.connection.client.stream('statuses/filter', { follow: all_IDs.join(',').toString() });
                
                node.stream.on('connect', function (request) {
                    node.log('streaming API connecting');
                    node.status({fill:"yellow",shape:"dot",text:"connecting"});
                });
                
                node.stream.on('connected', function (response) {
                    node.log('streaming API connected. Streaming names: ' + all_names.join(', ').toString());
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
                    if (all_IDs.indexOf(tweet.user.id_str) > -1)
                    {
                        node.log(tweet.user.name + ': ' + tweet.text);
                        var msg = {
                            payload: tweet
                        }
                        node.send(msg);
                    }
                });
            }
            catch (error) {
                node.error(util.inspect(error, { showHidden: true, depth: null }));
            }
        });
        
        this.on("close", function() {
            if (node.stream) {
                node.log('stopping stream on close');
                node.stream.stop();
                delete node.stream;
            }
        });
    }
    RED.nodes.registerType("Twitter Users",TwitterStreamUser);
    
        //Twitter stream of topics
    function TwitterStreamTopics(n) {
        RED.nodes.createNode(this,n);
        var node = this;
        node.topics = n.topics;
        node.connection = RED.nodes.getNode(n.connection);
        node.status({fill:"yellow",shape:"dot",text:"connecting"});
        
        node.stream = node.connection.client.stream('statuses/filter', {track: node.topics});
        
        node.stream.on('connect', function (request) {
            node.log('streaming API connecting');
            node.status({fill:"yellow",shape:"dot",text:"connecting"});
        });
        
        node.stream.on('connected', function (response) {
            node.log('streaming topics: ' + node.topics);
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
            node.log(tweet.user.name + ': ' + tweet.text);
            var msg = {
                payload: tweet
            }
            node.send(msg);
        });
        
        this.on("close", function() {
            if (node.stream) {
                node.log('stopping stream on close');
                node.stream.stop();
                delete node.stream;
            }
        });
    }
    RED.nodes.registerType("Twitter Topics",TwitterStreamTopics);
    
    //Twitter stream
    function TwitterStream(n) {
        RED.nodes.createNode(this,n);
        var node = this;
        node.follow = n.follow || "";
        node.topics = n.topics || "";
        node.topicRetweets = n.topicRetweets || false;
        node.topicLanguage = n.topicLanguage.toString().trim().split(",") || ['en','de'];
        node.debug = n.debug || false;
        node.waitForUserLookup = false;
        node.userNames = [];
        node.userIDs = [];
        node.streamOptions = {};
        node.connection = RED.nodes.getNode(n.connection);
        node.status({fill:"yellow",shape:"dot",text:"connecting"});
        
        if (node.topics != "") {
            node.streamOptions.track = node.topics;
        }
        
        if (node.follow != "") {
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
                    if (node.topicRetweets === false && node.userIDs.indexOf(tweet.user.id_str) < 0 && tweet.retweeted_status) {
                        if (node.debug) {
                            node.log('skipping retweet:\n' + util.inspect(tweet, { showHidden: true, depth: null }));
                        }
                    }
                    else {
                        if (node.topicLanguage.indexOf(tweet.lang) > -1) {
                            node.send({ payload: tweet });
                            if (node.debug) {
                                node.log(util.inspect(tweet, { showHidden: true, depth: null }));
                            } else {
                                node.log(tweet.user.name + ': ' + tweet.text);
                            }
                        }
                        else {
                            if (node.debug) {
                                node.log('skipping language:\n' + util.inspect(tweet, { showHidden: true, depth: null }));
                            }
                        }
                    }
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
}
