/**
 * Copyright (c) 2015, OCEAN
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file Main code of Mobius Yellow. Role of flow router
 * @copyright KETI Korea 2015, OCEAN
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var fs = require('fs');
var http = require('http');
var pg = require('pg');
var express = require('express');
var bodyParser = require('body-parser');
var util = require('util');
var xml2js = require('xml2js');
var ip = require('ip');
var js2xmlparser = require("js2xmlparser");
var moment = require('moment');

var db_sql = require('./sql_action');

// ������ �����մϴ�.
var ts_app = express();

http.globalAgent.maxSockets = 1000000;

http.createServer(ts_app).listen({port: usetsagentport, agent: false}, function () {
    console.log('ts_missing agent server (' + ip.address() + ') running at ' + usetsagentport + ' port');

    // Searching TS with missingDetect. if it is TRUE, restart mddt
    init_TS(function (rsc) {
        console.log('init_TS - ' + rsc);
    });
});

function init_TS(callback) {
    var ri = '/missingDataDetect';
    var rqi = moment().utc().format('mmssSSS') + randomValueBase64(4);
    var options = {
        hostname: 'localhost',
        port: usetsagentport,
        path: ri,
        method: 'post',
        headers: {
            'X-M2M-RI': rqi,
            'Accept': 'application/xml',
            'X-M2M-Origin': usecseid,
            'Content-Type': 'application/vnd.onem2m-res+xml'
        }
    };

    //var reqBodyString = '';
    var jsonObj = {};
    jsonObj.ri = 'all';
    var reqBodyString = js2xmlparser('ts', JSON.stringify(jsonObj));

    var responseBody = '';
    var req = http.request(options, function (res) {
        res.setEncoding('utf8');
        res.on('data', function (chunk) {
            responseBody += chunk;
        });

        res.on('end', function() {
            callback(res.headers['x-m2m-rsc'], responseBody);
        });
    });

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('[init_TS] problem with request: ' + e.message);
        }
    });

    // write data to request body
    req.write(reqBodyString);
    req.end();
}


function search_TS(request, response, callback) {
    var ri = '/' + usecsebase + '?fu=1&ty=25';
    var rqi = moment().utc().format('mmssSSS') + randomValueBase64(4);
    var options = {
        hostname: 'localhost',
        port: usecsebaseport,
        path: ri,
        method: 'get',
        headers: {
            'X-M2M-RI': rqi,
            'Accept': 'application/xml',
            'X-M2M-Origin': usecseid,
            'nmtype': 'long'
        }
    };

    var responseBody = '';
    var req = http.request(options, function (res) {
        res.setEncoding('utf8');
        res.on('data', function (chunk) {
            responseBody += chunk;
        });

        res.on('end', function() {
            callback(request, response, res.headers['x-m2m-rsc'], responseBody);
        });
    });

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('[search_TS] problem with request: ' + e.message);
        }
    });

    // write data to request body
    req.write('');
    req.end();
}


var onem2mParser = bodyParser.text(
    {
        limit: '1mb',
        type: 'application/onem2m-resource+xml;application/xml;application/json;application/vnd.onem2m-res+xml;application/vnd.onem2m-res+json'
    }
);

var ts_timer = {};
var ts_timer_id = {};

var missing_detect_check = function(pin, mdd, mddt, cni, ri, callback) {
    var rsc = {};
    rsc.status = 2000;
    if((pin != null && pin != '' && pin != '0') && (mdd != null && mdd == 'TRUE') && mddt != '0') {
        if(ts_timer[ri] == null) {
            ts_timer[ri] = new process.EventEmitter();
            ts_timer[ri].on(ri, function () {
                db_sql.select_ts(ri, function (err, results) {
                    if (results.length == 1) {
                        console.log(results[0].ri);
                        var new_cni = results[0]['cni'];
                        if (parseInt(new_cni, 10) == parseInt(cni, 10)) {
                            if (parseInt(results[0].mdcn, 10) <= parseInt(results[0].mdmn, 10)) {
                                var cur_d = new Date();
                                var timestamp = cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '');
                                var mdl = timestamp + ' ' + results[0].mdl;
                                var mdcn = (parseInt(results[0].mdcn, 10) + 1).toString();
                                console.log(mdcn, mdl);
                                db_sql.update_ts_mdcn_mdl(mdcn, mdl, ri, function (err, results) {
                                    if (!err) {
                                    }
                                    else {
                                        console.log('query error: ' + results.message);
                                    }
                                });
                            }
                            else {
                                if(ts_timer_id[ri] != null) {
                                    clearInterval(ts_timer_id[ri]);
                                    delete ts_timer_id[ri];
                                }
                            }
                        }
                        cni = new_cni;
                    }
                });
            });
        }

        if(ts_timer_id[ri] == null) {
            ts_timer_id[ri] = setInterval(function () {
                ts_timer[ri].emit(ri);
            }, (parseInt(mddt) * 1000));
            rsc.status = 2000;
            rsc.ri = ri;
            callback(rsc);
        }
        else if(ts_timer_id[ri] != null) {
            clearInterval(ts_timer_id[ri]);
            ts_timer_id[ri] = setInterval(function () {
                ts_timer[ri].emit(ri);
            }, (parseInt(mddt)*1000));
            rsc.status = 2000;
            rsc.ri = ri;
            callback(rsc);
        }
        else {
            rsc.status = 2001;
            rsc.ri = ri;
            callback(rsc);
        }
    }
    else {
        if(ts_timer_id[ri] != null) {
            clearInterval(ts_timer_id[ri]);
            delete ts_timer_id[ri];
        }

        rsc.status = 2001;
        rsc.ri = ri;
        callback(rsc);
    }
};


//
ts_app.post('/missingDataDetect', onem2mParser, function(request, response) {
    var fullBody = '';
    request.on('data', function(chunk) {
        fullBody += chunk.toString();
    });
    request.on('end', function() {
        request.body = fullBody;
        var parser = new xml2js.Parser({explicitArray: false});
        parser.parseString(request.body.toString(), function (err, result) {
            if (err) {
                NOPRINT == 'true' ? NOPRINT = 'true' : console.log('[retrieve_CSEBase_http parsing error]');
            }
            else {
                var jsonString = JSON.stringify(result);
                var jsonObj = JSON.parse(jsonString);
                if (jsonObj.ts.ri == 'all') {
                    search_TS(request, response, function (request, response, rsc, responseBody) {
                        //console.log(rsc);
                        //console.log(responseBody);

                        var parser = new xml2js.Parser({explicitArray: false});
                        parser.parseString(responseBody.toString(), function (err, result) {
                            if (err) {
                                NOPRINT == 'true' ? NOPRINT = 'true' : console.log('[retrieve_CSEBase_http parsing error]');
                            }
                            else {
                                var jsonString = JSON.stringify(result);
                                var jsonObj = JSON.parse(jsonString);
                                if (jsonObj['m2m:responsePrimitive']) {
                                    var ts_ri = [];
                                }
                                else if (jsonObj['m2m:URIList']['_'] == null) {
                                    ts_ri = [];
                                }
                                else {
                                    ts_ri = jsonObj['m2m:URIList']['_'].toString().split(' ');
                                }

                                var ts = {};
                                if (ts_ri.length >= 1) {
                                    db_sql.select_ts_in(ts_ri, function (err, results_ts) {
                                        if (!err) {
                                            if (results_ts.length >= 1) {
                                                missing_detect_check(results_ts[0].pin, results_ts[0].mdd, results_ts[0].mddt, results_ts[0].cni, results_ts[0].ri, function (rsc) {
                                                    console.log(rsc);
                                                });
                                            }
                                        }

                                        response.setHeader('X-M2M-RSC', '2000');

                                        ts.status = '2000';
                                        ts.ri = jsonObj['m2m:URIList']['_'];
                                        response.status(200).end(JSON.stringify(ts));
                                    });
                                }
                                else {
                                    response.setHeader('X-M2M-RSC', '4004');
                                    ts.status = '4004';
                                    ts.ri = '';
                                    response.status(404).end(JSON.stringify(ts));
                                }
                            }
                        });
                    });
                }
                else {
                    db_sql.select_ts(jsonObj.ts.ri, function (err, results_ts) {
                        if (!err) {
                            if (results_ts.length == 1) {
                                missing_detect_check(results_ts[0].pin, results_ts[0].mdd, results_ts[0].mddt, results_ts[0].cni, results_ts[0].ri, function (rsc) {
                                    console.log(rsc.status + ' - ' + rsc.ri);
                                    response.setHeader('X-M2M-RSC', '2000');
                                    response.status(200).end(JSON.stringify(rsc));
                                });
                            }
                        }
                    });
                }
            }
        });
    });
});


ts_app.delete('/missingDataDetect', onem2mParser, function(request, response) {
    var fullBody = '';
    request.on('data', function(chunk) {
        fullBody += chunk.toString();
    });
    request.on('end', function() {
        request.body = fullBody;
        var parser = new xml2js.Parser({explicitArray: false});
        parser.parseString(request.body.toString(), function (err, result) {
            if (err) {
                console.log('[retrieve_CSEBase_http parsing error]');
            }
            else {
                var jsonString = JSON.stringify(result);
                var jsonObj = JSON.parse(jsonString);
                var ri = jsonObj.ts.ri;
                if(ts_timer[ri] != null) {
                    ts_timer[ri].removeAllListeners(ri);
                    delete ts_timer[ri];
                }

                if(ts_timer_id[ri] != null) {
                    clearInterval(ts_timer_id[ri]);
                    delete ts_timer_id[ri];
                }

                var rsc = {};
                rsc.status = 2000;
                rsc.ri = ri;
                console.log(rsc.status + ' - ' + rsc.ri);
                response.setHeader('X-M2M-RSC', '2000');
                response.status(200).end(JSON.stringify(rsc));
            }
        });
    });
});
