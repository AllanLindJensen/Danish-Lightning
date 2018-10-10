// Connecting to lnd (using Example on accessing API)

var fs = require('fs');
var grpc = require('grpc');
var life_span = 3600; // bills expire in 1 hour
var waitingList = []; // list of bills awating payment

process.env.GRPC_SSL_CIPHER_SUITES = 'HIGH+ECDSA'

var m = fs.readFileSync('/home/allan/.lnd/data/chain/bitcoin/mainnet/admin.macaroon');
var macaroon = m.toString('hex');

// build meta data credentials
var metadata = new grpc.Metadata();
metadata.add('macaroon', macaroon);
var macaroonCreds = grpc.credentials.createFromMetadataGenerator((_args, callback) => {
  callback(null, metadata);
});

// build ssl credentials using the cert the same as before
var lndCert = fs.readFileSync("/home/allan/.lnd/tls.cert");
var sslCreds = grpc.credentials.createSsl(lndCert);

// combine the cert credentials and the macaroon auth credentials
// such that every call is properly encrypted and authenticated
var credentials = grpc.credentials.combineChannelCredentials(sslCreds, macaroonCreds);

var protoLoader = require('@grpc/proto-loader');
// Suggested options for similarity to existing grpc.load behavior
var packageDefinition = protoLoader.loadSync(
    "Protos/lnd_rpc.proto",
    {keepCase: true,
     longs: String,
     enums: String,
     defaults: true,
     oneofs: true
    });

var gi_proto = grpc.loadPackageDefinition(packageDefinition).lnrpc;
// Pass the crendentials when creating the client
var client = new gi_proto.Lightning('localhost:10009', credentials);

//Danish Lightning rpc server
var awaitList = []; // list of processes awaiting confirmation of payment
  // Added by call to awaitPayment
  // Deleted by a) payment, b) checkPayment c) every day old ones
  // {time: longint, RHash: string, caller: streamObject}

// functions converting the byte[] r_hash to HEX string and back

function toHexString(byteArray) {
  return Array.prototype.map.call(byteArray, function(byte) {
    return ('0' + (byte & 0xFF).toString(16)).slice(-2);
  }).join('');
}

function toByteArray(hexString) {
  var result = new Uint8Array(32); var n = hexString.length;
  for (var i = 0; i<n;i = i+2) {
    result[i >>> 1] = (parseInt("0x"+hexString.substring(i, i+2), 16));
  }
  return result;
}

/**
 * GetBill RPC method.
 */
function getBill(call, callback) {
  var memo = call.request.memo;
  var amt = call.request.amount;
  var order_ID = call.request.orderID;
  client.addInvoice({
      "memo": memo,
      "value": amt,
      "expiry": life_span
      }, function(err, response) {
      if (err != null) {
        callback(err,{})
      } else {
        //we have a bill
        var rHash = toHexString(response.r_hash);
        callback(null, {
          billText: response.payment_request,
          r_hash: rHash
        });
        console.log(new Date().toUTCString() + " " +memo + " " + amt + " " + rHash);
      }
  });
}

/**
 * CheckPayment RPC method.
 */
function checkPayment(call, callback) {
  var rHashText = call.request.r_hash;
  var rHash = toByteArray(rHashText);
  client.lookupInvoice({
        r_hash: rHash
      }, function(err, response) {
        if (err != null) {
          callback(err,{})
        } else {
            var memo = response.memo;
            console.log(new Date().toUTCString() + " " + rHashText + " for " + memo + " paid: " + response.paid);
            var i = searchHashInWaitingList(r_hash);
            var found = (i != -1);
            var order_ID; 
            if (found) {
              order_ID = waitingList[i].orderID;
            } else {
              order_ID = 0;
            }
            callback(null,{
                'paid': response.settled,
                'ID_known': found,
                'orderID': orderID,
                'memo': memo,
                'amount': response.amt
            });
        }
  });
}

/*
 * Wait for the bill to be paid. Put it on the waitingList
 */

function awaitPayment(call, callback) {
  var rHash = call.request.r_hash;
  var order_ID = call.request.orderID;
  var i = searchHashInWaitingList(rHash);
  if (i == -1) 
  {
    waitingList.push({
        'time': Date.now(),
        'RHASH': rHash,
        'orderID': order_ID,
        'callBack': callback
    });
    console.log(new Date().toUTCString() + " Added to waiting list " + rHash + ", ID: " + order_ID);
  } else {
    console.log(new Date().toUTCString() + " Updating waiting list " + rHash);
    waitingList[i].callBack = callback;
  }
}

//when LND informs that a bill has been paid
function billPaid(invoice) {
    var memo = invoice.memo;
    var paidHash = toHexString(invoice.r_hash);
    var i = searchHashInWaitingList(paidHash);
    if (i == -1) return;  //not on the waitingList
    waitingList[i].callBack(null,{
      'orderID': waitingList[i].orderID,
      'r_hash': toHexString(invoice.r_hash),
      'amount': invoice.amt
    });
    console.log(new Date().toUTCString() + " paid " + paidHash + " for " + memo);
    waitingList.splice(i,1); // remove from waitingList
}

// functions regarding the waitingList

function searchHashInWaitingList(RHash) {
  return waitingList.findIndex( el => {
        return (el.RHASH == RHash);
    });
}

  //TODO
function sanatizeWaitingList() {
// this procedure has poor logic.
  console.log("sanatizing the waitingList");
  var limit = new Date() - life_span;
  var index = 0;
  while (index > -1) {
    index = waitingList.findIndex(el => {
    return el.time < limit;
    });
    if (index > -1) {
      console.log("expired " + waitingList[index].RHASH);
      waitingList.splice(index,1);
    }
  }
}

// open the server

function main() {
  if (process.argv.length > 2) {
    // the user entered something more than node server.js
    console.log("The Danish Lightning server, version 0.2.0");
    console.log("Usage: node server.js");
    console.log("License: MIT");
    console.log("Copyright (c) [2018] [Allan Lind Jensen, Denmark]\n\n"+

      "Permission is hereby granted, free of charge, to any person obtaining a copy\n" +
      "of this software and associated documentation files (the 'Software'), to deal\n" +
      "in the Software without restriction, including without limitation the rights\n" +
      "to use, copy, modify, merge, publish, distribute, sublicense, and/or sell\n" +
      "copies of the Software, and to permit persons to whom the Software is\n" +
      "furnished to do so, subject to the following conditions:\n\n" +

      "The above copyright notice and this permission notice shall be included in all\n" +
      "copies or substantial portions of the Software.\n\n" +

      "THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\n" +
      "IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\n" +
      "FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\n" +
      "AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\n" +
      "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\n" +
      "OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n");
    process.exit(0);
  }
  packageDefinition = protoLoader.loadSync(
    "Protos/DanishLightning.proto",
    {keepCase: true,
     longs: String,
     enums: String,
     defaults: true,
     oneofs: true
    });
  var DL_proto = grpc.loadPackageDefinition(packageDefinition).dl_server;
  var server = new grpc.Server();
  server.addService(DL_proto.HandleBill.service, {getBill: getBill, awaitPayment: awaitPayment, checkPayment: checkPayment});
  server.bind('0.0.0.0:14204', grpc.ServerCredentials.createInsecure());
  server.start();

  // subscribe to paid invoices
  var lnd = client.subscribeInvoices({});
  lnd.on('data', billPaid);
  lnd.on('end', function() {
    // The server has finished sending
    console.log(new Date().toUTCString() + " LND stops:");
  });
  lnd.on('error', function(err) {
    console.log(new Date().toUTCString() + " ERR: " + err);
  });
  lnd.on('status', function(status) {
    // Process status
    console.log(new Date().toUTCString() + "Current status: " + JSON.stringify(status));
  });
  setInterval(sanatizeWaitingList, 24*3600000); //once a day
  console.log(new Date().toUTCString() + " Initialization complete");
}

main();
