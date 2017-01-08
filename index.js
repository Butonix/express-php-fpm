const express = require('express')
const FCGI = require('./fcgi')
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
    this.connections = new Array(100)
  }
  
  handle(req, res, next) {
    let file = this.withoutQueryString(req.url)
    if(file.endsWith('/')) { file += 'index.php' }
    if(!file.endsWith('.php')) { next(); return }
    
    new Responder(this, file, req, res, next)
  }
  
  getFreeReqId() {
    let i = 0
    while(this.connections[++i]) { }
    this.connections[i] = true
    return i
  }
  
  freeUpReqId(reqId) {
    this.connections[reqId] = false
  }
  
  withoutQueryString(url) {
    const sep = url.indexOf('?')
    return (sep == -1) ? url : url.substr(0, sep)
  }
}

class Responder {
  constructor(socketOptions, reqId, env, req, res, onClose) {
    debug('new Responder reqId %i', reqId)
    
    // locals
    this.reqId = reqId
    this.res = res
    this.buffer = Buffer.alloc(0)
    this.gotHead = false
    
    // socket
    this.socket = net.connect(socketOptions)
    this.socket.on('data', this.data.bind(this))
    this.socket.on('close', onClose)
    
    // send req
    this.send(FCGI.MSG.BEGIN_REQUEST, FCGI.BeginRequestBody(FCGI.ROLE.RESPONDER, FCGI.DONT_KEEP_CONN))
    this.send(FCGI.MSG.PARAMS, FCGI.NameValuePair(env))
    this.send(FCGI.MSG.PARAMS, Buffer.alloc(0))
    req.on('data', this.reqData.bind(this))
    req.on('end', this.reqEnd.bind(this))
  }
  
  reqData(chunk) {
    this.send(FCGI.MSG.STDIN, chunk)
  }
  
  reqEnd() {
    this.send(FCGI.MSG.STDIN, Buffer.alloc(0))
  }
  
  send(msgType, content) {
    debug('send %s', FCGI.GetMsgType(msgType))
    
    for(let offset = 0; offset < content.length || offset == 0; offset += 0xFFFF) {
      const chunk = content.slice(offset, offset + 0xFFFF)
      const header = FCGI.Header(FCGI.VERSION_1, msgType, this.reqId, chunk.length, 0)
      this.socket.write(header)
      this.socket.write(chunk)
    }
  }
  
  data(data) {
    this.buffer = Buffer.concat([ this.buffer, data ])
    
    while(this.buffer.length) {
      const record = FCGI.ParseHeader(this.buffer)
      if(!record) { break }
      
      this.buffer = this.buffer.slice(record.recordLength)
      this.record(record)
    }
  }
  
  record(record) {
    debug('got %s', FCGI.GetMsgType(record.type))
    
    switch(record.type) {
      case FCGI.MSG.STDERR:
        break
      
      case FCGI.MSG.STDOUT:
        this.stdout(record.content)
        break
      
      case FCGI.MSG.END_REQUEST:
        this.res.end()
        break
      
      case FCGI.MSG.GET_VALUES_RESULT:
        break
      
    }
  }
  
  stdout(content) {
    if(this.gotHead) {
      this.res.write(content)
      return
    }
    this.gotHead = true
    
    const sep = content.indexOf('\r\n\r\n')
    const head = content.slice(0, sep)
    const body = content.slice(sep + 4)
    
    const headers = {}
    for(const h of head.toString().split('\r\n')) {
      const hsep = h.indexOf(':')
      const hkey = h.substr(0, hsep)
      const hval = h.substr(hsep + 2)
      
      if(hkey == "Status") {
        this.res.status(parseInt(hval.substr(0, 3)))
        continue
      }
      if(!(hkey in headers)) { headers[hkey] = [] }
      headers[hkey].push(hval)
    }
    
    this.res.set(headers)
    this.res.write(body)
  }
}

function createEnviroment(req, documentRoot, file, qs, extraEnv) {
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
    
    DOCUMENT_ROOT:      documentRoot,
    SCRIPT_FILENAME:    documentRoot + file,
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
  
  Object.assign(env, extraEnv)
  
  return env
}
