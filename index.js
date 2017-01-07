const express = require('express')
const FCGI = require('./node-fcgi')
const net = require('net')

module.exports = init

function init(opt) {
  return new Handler(opt).router
}

class Handler {
  constructor(opt) {
    this.router = express.Router()
    this.router.use(this.handle.bind(this))
    this.router.use(express.static(opt.documentRoot))
    
    this.opt = opt
  }
  
  handle(req, res, next) {
    const sep  = req.url.indexOf('?')
    const file = (sep == -1) ? req.url : req.url.substr(0, sep)
    const qs   = (sep == -1) ? ''      : req.url.substr(sep + 1)
    
    if(!file.endsWith('.php')) { next(); return }
    
    const args = {
      GATEWAY_INTERFACE:  'CGI/1.1',
      PATH:               '',
      
      REQUEST_METHOD:     req.method,
      REDIRECT_STATUS:    200,
      
      REMOTE_ADDR:        req.connection.remoteAddress,
      REMOTE_PORT:        req.connection.remotePort,
      
      SERVER_PROTOCOL:    req.protocol.toUpperCase() + '/' + req.httpVersion,
      SERVER_ADDR:        req.connection.localAddress,
      SERVER_PORT:        req.connection.localPort,
      
      SERVER_SOFTWARE:    'express-php-fpm',
      SERVER_NAME:        '',
      SERVER_ADMIN:       '',
      SERVER_SIGNATURE:   '',
      
      DOCUMENT_ROOT:      this.opt.documentRoot,
      SCRIPT_FILENAME:    this.opt.documentRoot + file,
      SCRIPT_NAME:        file,
      
      REQUEST_URI:        req.url,
      QUERY_STRING:       qs,
      
      CONTENT_TYPE:       req.headers['content-type'] || '',
      CONTENT_LENGTH:     req.headers['content-length'] || '',
      
      // AUTH_TYPE
      // PATH_INFO
      // PATH_TRANSLATED
      // REMOTE_HOST
      // REMOTE_IDENT
      // REMOTE_USER
      // UNIQUE_ID
    }
    
    for(const key of Object.keys(req.headers)) {
      args['HTTP_' + key.toUpperCase()] = req.headers[key]
    }
    
    const post = new Buffer(8)
    
    const conn = new Connection(this.opt, 1, args, post, res)
  }
}

class Connection {
  constructor(opt, reqId, args, post, res) {
    // locals
    this.reqId = reqId
    this.res = res
    
    // socket
    this.socket = net.connect(opt.connectOptions)
    this.socket.on('data', this.data.bind(this))
    //socket.on('close', onClose)
    
    // send req
    this.send(FCGI.MSG.BEGIN_REQUEST, FCGI.BeginRequestBody(FCGI.ROLE.RESPONDER, 0))
    this.send(FCGI.MSG.PARAMS, FCGI.NameValuePair(args))
    this.send(FCGI.MSG.STDIN, post)
    
    // data buffer
    this.buffer = Buffer.alloc(0)
  }
  
  send(msgType, content) {
    const header = FCGI.Header(FCGI.VERSION_1, msgType, this.reqId, content.length, 0)
    this.socket.write(header)
    this.socket.write(content)
  }
  
  data(data) {
    this.buffer = Buffer.concat([ this.buffer, data ])
    
    while(this.buffer.length) {
      const record = FCGI.ParseHeader(this.buffer)
      if(record.recordLength > this.buffer.length) { break }
      
      record.content = this.buffer.slice(8, 8 + record.contentLength)
      this.record(record)
      
      this.buffer = this.buffer.slice(record.recordLength)
    }
  }
  
  record(record) {
    const res = this.res
    
    if(record.type == FCGI.MSG.END_REQUEST) {
      res.end()
      return
    }
    if(record.type != FCGI.MSG.STDOUT) {
      console.log(record)
      console.log(record.content.toString())
      return
    }
    if(res.headersSent) {
      res.write(record.content)
    }
    else {
      const content = record.content
      
      const sep = content.indexOf('\r\n\r\n')
      const head = content.slice(0, sep)
      const body = content.slice(sep + 4)
    
      const headers = head.toString().split('\r\n')
      for(let h of headers) {
        const hsep = h.indexOf(':')
        const hkey = h.substr(0, hsep)
        const hval = h.substr(hsep + 2)
        if(hkey == "Status") {
          res.status(hval.substr(0, 3))
        }
        else {
          res.set(hkey, hval)
        }
      }
      res.write(body)
    }
  }
}
