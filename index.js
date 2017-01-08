const express = require('express')
const FCGI = require('./node-fcgi')
const net = require('net')
const debug = require('debug')('express-php-fpm')

module.exports = init

function init(opt) {
  return new Handler(opt).router
}

class Handler {
  constructor(opt) {
    debug('new Router')
    this.router = express.Router()
    this.router.use(this.handle.bind(this))
    this.router.use(express.static(opt.documentRoot))
    
    this.opt = opt
  }
  
  createEnviroment(req, file, qs) {
    const env = {
      GATEWAY_INTERFACE:  'CGI/1.1',
      PATH:               '',
      
      REQUEST_METHOD:     req.method,
      REDIRECT_STATUS:    200, // http://stackoverflow.com/questions/24378472/what-is-php-serverredirect-status
      
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
      env['HTTP_' + key.toUpperCase().replace(/-/g, '_')] = req.headers[key]
    }
    
    return env
  }
  
  handle(req, res, next) {
    const sep  = req.url.indexOf('?')
    const file = (sep == -1) ? req.url : req.url.substr(0, sep)
    const qs   = (sep == -1) ? ''      : req.url.substr(sep + 1)
    
    if(!file.endsWith('.php')) { next(); return }
    
    debug('handle %s', file)
    const env = this.createEnviroment(req, file, qs)
    
    new Connection(this.opt, 1, env, req, res)
  }
}

class Connection {
  constructor(opt, reqId, env, req, res) {
    debug('new Connection')
    
    // locals
    this.reqId = reqId
    this.res = res
    
    // socket
    this.socket = net.connect(opt.connectOptions)
    this.socket.on('data', this.data.bind(this))
    //socket.on('close', onClose)
    
    // send req
    this.send(FCGI.MSG.BEGIN_REQUEST, FCGI.BeginRequestBody(FCGI.ROLE.RESPONDER, 0))
    this.send(FCGI.MSG.PARAMS, FCGI.NameValuePair(env))
    this.send(FCGI.MSG.PARAMS, Buffer.alloc(0))
    
    req.on('data', this.reqData.bind(this))
    req.on('end', this.reqEnd.bind(this))
    
    // data buffer
    this.buffer = Buffer.alloc(0)
  }
  
  reqData(chunk) {
    this.send(FCGI.MSG.STDIN, chunk)
  }
  
  reqEnd() {
    this.send(FCGI.MSG.STDIN, Buffer.alloc(0))
  }
  
  send(msgType, content) {
    debug('send ' + FCGI.GetMsgType(msgType))
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
    debug('got ' + FCGI.GetMsgType(record.type))
    
    switch(record.type) {
      case FCGI.MSG.END_REQUEST:
        this.res.end()
        break
      
      case FCGI.MSG.STDOUT:
        this.stdout(record)
        break
        
      default:
        console.log('Got ' + FCGI.GetMsgType(record.type))
    }
  }
  
  stdout(record) {
    const res = this.res
    
    if(res.headersSent) {
      res.write(record.content)
    }
    else {
      const content = record.content
      
      const sep = content.indexOf('\r\n\r\n')
      const head = content.slice(0, sep)
      const body = content.slice(sep + 4)
    
      const headers = head.toString().split('\r\n')
      for(const h of headers) {
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
