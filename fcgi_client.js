const net = require('net')
const FCGI = require('./fcgi')

module.exports = class Client {
  constructor(socketOptions) {
    this.buffer = Buffer.alloc(0)
    this.reqId = 0
    
    this.socket = net.connect(socketOptions)
    this.socket.on('data', this.onData.bind(this))
    if(this.onClose) { this.socket.on('close', this.onClose.bind(this)) }
    if(this.onError) { this.socket.on('error', this.onError.bind(this)) }
  }
  
  send(msgType, content) {
    for(let offset = 0; offset < content.length || offset == 0; offset += 0xFFFF) {
      const chunk = content.slice(offset, offset + 0xFFFF)
      const header = FCGI.Header(FCGI.VERSION_1, msgType, this.reqId, chunk.length, 0)
      this.socket.write(header)
      this.socket.write(chunk)
    }
  }
  
  onData(data) {
    this.buffer = Buffer.concat([ this.buffer, data ])
    
    while(this.buffer.length) {
      const record = FCGI.ParseHeader(this.buffer)
      if(!record) { break }
      
      this.buffer = this.buffer.slice(record.recordLength)
      this.got(record)
    }
  }
  
  got(record) {
    // to be implemented in parent class
  }
}
