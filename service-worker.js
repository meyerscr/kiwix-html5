/**
 * service-worker.js : Service Worker implementation,
 * in order to capture the HTTP requests made by an article, and respond with the
 * corresponding content, coming from the archive
 * 
 * Copyright 2015 Mossroy and contributors
 * License GPL v3:
 * 
 * This file is part of Evopedia.
 * 
 * Evopedia is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * Evopedia is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with Evopedia (file LICENSE-GPLv3.txt).  If not, see <http://www.gnu.org/licenses/>
 */
'use strict';
// TODO : remove requirejs if it's really useless here
importScripts('./www/js/lib/require.js');


self.addEventListener('install', function(event) {
    event.waitUntil(self.skipWaiting());
    console.log("ServiceWorker installed");
});

self.addEventListener('activate', function(event) {
    // "Claiming" the ServiceWorker is necessary to make it work right away,
    // without the need to reload the page.
    // See https://developer.mozilla.org/en-US/docs/Web/API/Clients/claim
    event.waitUntil(self.clients.claim());
    console.log("ServiceWorker activated");
});

require({
    baseUrl: "./www/js/lib/"
},
["util"],

function(util) {

    console.log("ServiceWorker startup");
    
    var outgoingMessagePort = null;
    
    self.addEventListener('message', function (event) {
        if (event.data.action === 'init') {
            console.log('Init message received', event.data);
            outgoingMessagePort = event.ports[0];
            console.log('outgoingMessagePort initialized', outgoingMessagePort);
            self.addEventListener('fetch', fetchEventListener);
            console.log('fetchEventListener enabled');
        }
        if (event.data.action === 'disable') {
            console.log('Disable message received');
            outgoingMessagePort = null;
            console.log('outgoingMessagePort deleted');
            self.removeEventListener('fetch', fetchEventListener);
            console.log('fetchEventListener removed');
        }
    });
    
    // TODO : this way to recognize content types is temporary
    // It must be replaced by reading the actual MIME-Type from the backend
    var regexpJPEG = new RegExp(/\.jpe?g$/i);
    var regexpPNG = new RegExp(/\.png$/i);
    var regexpJS = new RegExp(/\.js/i);
    var regexpCSS = new RegExp(/\.css$/i);

    var regexpContentUrlWithNamespace = new RegExp(/\/(.)\/(.*[^\/]+)$/);
    var regexpContentUrlWithoutNamespace = new RegExp(/^([^\/]+)$/);
    var regexpDummyArticle = new RegExp(/dummyArticle\.html$/);
    
    function fetchEventListener(event) {
        console.log('ServiceWorker handling fetch event for : ' + event.request.url);

        // TODO handle the dummy article more properly
        if ((regexpContentUrlWithNamespace.test(event.request.url)
                || regexpContentUrlWithoutNamespace.test(event.request.url))
            && !regexpDummyArticle.test(event.request.url)) {

            console.log('Asking app.js for a content', event.request.url);
            event.respondWith(new Promise(function(resolve, reject) {
                var nameSpace;
                var titleName;
                var titleNameWithNameSpace;
                var contentType;
                if (regexpContentUrlWithoutNamespace.test(event.request.url)) {
                    // When the request URL is in the same folder,
                    // it means it's a link to an article (namespace A)
                    var regexpResult = regexpContentUrlWithoutNamespace.exec(event.request.url);
                    nameSpace = 'A';
                    titleName = regexpResult[1];
                } else {
                    var regexpResult = regexpContentUrlWithNamespace.exec(event.request.url);
                    nameSpace = regexpResult[1];
                    titleName = regexpResult[2];
                }

                // The namespace defines the type of content. See http://www.openzim.org/wiki/ZIM_file_format#Namespaces
                // TODO : read the contentType from the ZIM file instead of hard-coding it here
                if (nameSpace === 'A') {
                    console.log("It's an article : " + titleName);
                    contentType = 'text/html';
                }
                else if (nameSpace === 'I' || nameSpace === 'J') {
                    console.log("It's an image : " + titleName);
                    if (regexpJPEG.test(titleName)) {
                        contentType = 'image/jpeg';
                    }
                    else if (regexpPNG.test(titleName)) {
                        contentType = 'image/png';
                    }
                }
                else if (nameSpace === '-') {
                    console.log("It's a layout dependency : " + titleName);
                    if (regexpJS.test(titleName)) {
                        contentType = 'text/javascript';
                        var responseInit = {
                            status: 200,
                            statusText: 'OK',
                            headers: {
                                'Content-Type': contentType
                            }
                        };

                        var httpResponse = new Response(';', responseInit);

                        // TODO : temporary before the backend actually sends a proper content
                        resolve(httpResponse);
                        return;
                    }
                    else if (regexpCSS.test(titleName)) {
                        contentType = 'text/css';
                    }
                }
                
                // We need to remove the potential parameters in the URL
                titleName = util.removeUrlParameters(decodeURIComponent(titleName));
                
                titleNameWithNameSpace = nameSpace + '/' + titleName;

                // Let's instanciate a new messageChannel, to allow app.s to give us the content
                var messageChannel = new MessageChannel();
                messageChannel.port1.onmessage = function(event) {
                    if (event.data.action === 'giveContent') {
                        console.log('content message received for ' + titleNameWithNameSpace, event.data);
                        var responseInit = {
                            status: 200,
                            statusText: 'OK',
                            headers: {
                                'Content-Type': contentType
                            }
                        };
                        
                        var httpResponse = new Response(event.data.content, responseInit);

                        console.log('ServiceWorker responding to the HTTP request for ' + titleNameWithNameSpace + ' (size=' + event.data.content.length + ' octets)' , httpResponse);
                        resolve(httpResponse);
                    }
                    else {
                        console.log('Invalid message received from app.js for ' + titleNameWithNameSpace, event.data);
                        reject(event.data);
                    }
                };
                console.log('Eventlistener added to listen for an answer to ' + titleNameWithNameSpace);
                outgoingMessagePort.postMessage({'action': 'askForContent', 'titleName': titleNameWithNameSpace}, [messageChannel.port2]);
                console.log('Message sent to app.js through outgoingMessagePort');
            }));
        }
        // If event.respondWith() isn't called because this wasn't a request that we want to handle,
        // then the default request/response behavior will automatically be used.
    }
});
