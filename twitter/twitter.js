module.exports = function(RED) {
	try {
	"use strict";
	var util = require('util');
	var Twitter = require('twitter');

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


		util.log('[Twitter-Stream] - create new Twitter instance for: ' + id);
		clients[id] = new Twitter({
			consumer_key: node.consumerKey,
			consumer_secret: node.consumerSecret,
			access_token_key: node.accessToken,
			access_token_secret: node.accessSecret,
		});
		
		node.client = clients[id];

		this.on("close", function() {
			util.log('[Twitter-Stream] - delete Twitter instance on close event');
			delete clients[id];
		});
	}
	RED.nodes.registerType("twitter-api-connection",TwitterAPIConnection);

	//Twitter stream of users
	function TwitterStreamUsers(n) {
		RED.nodes.createNode(this,n);
		var node = this;
		node.follow = n.follow;
		node.connection = RED.nodes.getNode(n.connection);
		node.status({fill:"red",shape:"dot",text:"connecting"});
		
		node.connection.client.get('users/lookup', {screen_name: node.follow}, function(error, tweets, response){
			if (error) {
				node.status({fill:"red",shape:"dot",text:"error"});
				util.log('[Twitter-Stream] - ERR: ' + error);
				return;
			}
			try {
				var all_screen_names = JSON.parse(response.body);
				var all_IDs = [];
				var all_names = [];
				for (var i=0; i < all_screen_names.length; i++)
				{
					all_IDs.push(all_screen_names[i].id_str);
					all_names.push(all_screen_names[i].name);
				}
				node.connection.client.stream('statuses/filter', {follow: all_IDs.join(',')}, function(stream){
					util.log('[Twitter-Stream] - streaming names: ' + all_names.join(','));
					util.log('[Twitter-Stream] - streaming names: ' + all_IDs.join(','));
					node.status({fill:"green",shape:"dot",text:"connected"});
					
					node.stream = stream;
					
					stream.on('data', function(tweet) {
						if (all_IDs.indexOf(tweet.user.id_str) > -1)
						{
							util.log('[Twitter-Stream] - Tweet: ' + tweet.text);
							var msg = {
								payload: tweet
							}
							node.send(msg);
						}
					});
					
					stream.on('error', function(error) {
						node.status({fill:"red",shape:"dot",text:"error"});
						util.log('[Twitter-Stream] - ERR: ' + error);
					});
				});
			}
			catch (e) {
				util.log('[Twitter-Stream] - ERR: ' + e);
			}
		});
		
		this.on("close", function() {
			if (node.stream) {
				util.log('[Twitter-Stream] - stopping stream on close');
				node.stream.destroy();
			}
		});
	}
	RED.nodes.registerType("Twitter Users",TwitterStreamUsers);
	
		//Twitter stream of topics
	function TwitterStreamTopics(n) {
		RED.nodes.createNode(this,n);
		var node = this;
		node.topics = n.topics;
		node.connection = RED.nodes.getNode(n.connection);
		node.status({fill:"red",shape:"dot",text:"connecting"});
		
		node.connection.client.stream('statuses/filter', {track: node.topics}, function(stream){
			util.log('[Twitter-Stream] - streaming topics: ' + node.topics);
			node.status({fill:"green",shape:"dot",text:"connected"});
			
			node.stream = stream;
			
			stream.on('data', function(tweet) {
				util.log('[Twitter-Stream] - Tweet: ' + tweet.text);
				var msg = {
					payload: tweet
				}
				node.send(msg);
			});
			
			stream.on('error', function(error) {
				node.status({fill:"red",shape:"dot",text:"error"});
				util.log('[Twitter-Stream] - ERR: ' + error);
			});
		});
		
		this.on("close", function() {
			if (node.stream) {
				util.log('[Twitter-Stream] - stopping stream on close');
				node.stream.destroy();
			}
		});
	}
	RED.nodes.registerType("Twitter Topics",TwitterStreamTopics);
	
	}
	catch(e){
		console.log(e);
	}
}
