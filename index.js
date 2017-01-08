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
    
    Object.assign(env, this.opt.env)
    
    return env
  }
  
  handle(req, res, next) {
    const sep  = req.url.indexOf('?')
    let file = (sep == -1) ? req.url : req.url.substr(0, sep)
    let qs   = (sep == -1) ? ''      : req.url.substr(sep + 1)
    
    if(file.endsWith('/')) { file += 'index.php' }
    if(!file.endsWith('.php')) { next(); return }
    
    debug('handle %s', file)
    const env = this.createEnviroment(req, file, qs)
    new Connection(this.opt.socketOptions, 1, env, req, res)
  }
}

class Connection {
  constructor(socketOptions, reqId, env, req, res) {
    debug('new Connection')
    
    // locals
    this.reqId = reqId
    this.res = res
    this.buffer = Buffer.alloc(0)
    this.gotHead = false
    
    // socket
    this.socket = net.connect(socketOptions)
    this.socket.on('data', this.data.bind(this))
    
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
    const header = FCGI.Header(FCGI.VERSION_1, msgType, this.reqId, content.length, 0)
    this.socket.write(header)
    this.socket.write(content)
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
