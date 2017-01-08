const FCGI = module.exports = {}

FCGI.VERSION_1  = 1

FCGI.NULL_REQUEST_ID  = 0

FCGI.DONT_KEEP_CONN   = 0
FCGI.KEEP_CONN        = 1

FCGI.ROLE   = { RESPONDER: 1, AUTHORIZER: 2, FILTER: 3 }
FCGI.MSG    = { BEGIN_REQUEST: 1, ABORT_REQUEST: 2, END_REQUEST: 3, PARAMS: 4, STDIN: 5, STDOUT: 6, STDERR: 7, DATA: 8, GET_VALUES: 9, GET_VALUES_RESULT: 10, UNKNOWN_TYPE: 11 }
FCGI.STATUS = { REQUEST_COMPLETE: 0, CANT_MPX_CONN: 1, OVERLOADED: 2, UNKNOWN_ROLE: 3 }

FCGI.GetMsgType = function(type) {
  if(!Number.isInteger(type)) { throw new TypeError('Type must be an integer') }
  
  for(const key of Object.keys(FCGI.MSG)) {
    if(FCGI.MSG[key] == type) { return key }
  }
}

FCGI.Header = function(version, type, requestId, contentLength, paddingLength) {
  if(!Number.isInteger(version)) { throw new TypeError('Version must be an integer') }
  if(!Number.isInteger(type)) { throw new TypeError('Message type must be an integer') }
  if(!Number.isInteger(requestId)) { throw new TypeError('Request id must be an integer') }
  if(!Number.isInteger(contentLength)) { throw new TypeError('Content length must be an integer') }
  if(!Number.isInteger(paddingLength)) { throw new TypeError('Padding length must be an integer') }
  if(contentLength > 0xFFFF) { throw new TypeError('Content is too big') }
  if(paddingLength > 0xFF) { throw new TypeError('Padding is too big') }
  
  const buff = Buffer.alloc(8)
  buff[0] = version             // unsigned char version
  buff[1] = type                // unsigned char type
  buff[2] = requestId >> 8      // unsigned char requestIdB1
  buff[3] = requestId           // unsigned char requestIdB0
  buff[4] = contentLength >> 8  // unsigned char contentLengthB1
  buff[5] = contentLength       // unsigned char contentLengthB0
  buff[6] = paddingLength       // unsigned char paddingLength
                                // unsigned char reserved
  return buff
}

FCGI.ParseHeader = function(buff) {
  if(!(buff instanceof Buffer)) { throw new TypeError('ParseHeader accepts only buffers') }
  
  const version       = buff[0]
  const type          = buff[1]
  const requestId     = buff[2] << 8 | buff[3]
  const contentLength = buff[4] << 8 | buff[5]
  const paddingLength = buff[6]
  
  const recordLength = 8 + contentLength + paddingLength
  
  if(recordLength > buff.length) { return null }
  
  const content = buff.slice(8, 8 + contentLength)
  
  return { version, type, requestId, contentLength, paddingLength, content, recordLength }
}

FCGI.BeginRequestBody = function(role, flags) {
  if(!Number.isInteger(role)) { throw new TypeError('Role must be an integer') }
  if(!Number.isInteger(flags)) { throw new TypeError('Flags must be an integer') }
  
  const buff = Buffer.alloc(8)
  buff[0] = role >> 8 // unsigned char roleB1
  buff[1] = role      // unsigned char roleB0
  buff[2] = flags     // unsigned char flags
                      // unsigned char reserved[5]
  return buff
}

FCGI.NameValuePair = function(name, value) {
  if(name && name.constructor == Object) {
    const bufs = []
    for(const key of Object.keys(name)) {
      bufs.push(FCGI.NameValuePair(key, name[key]))
    }
    return Buffer.concat(bufs)
  }
  
  if(!(name instanceof Buffer)) { name = String(name) }
  if(!(value instanceof Buffer)) { value = String(value) }
  if(name.length > 0xFFFFFFFF) { throw new TypeError('Name is too long.') }
  if(value.length > 0xFFFFFFFF) { throw new TypeError('Value is too long.') }
  
  const nameByteLength = (name.length > 127) ? 4 : 1
  const valueByteLength = (value.length > 127) ? 4 : 1
  
  const buff = Buffer.alloc(nameByteLength + valueByteLength + name.length + value.length)
  
  let i = 0
  if(nameByteLength == 4) {
    buff[i++] = name.length >> 24 | 1 << 7  // unsigned char nameLengthB3   // nameLengthB3  >> 7 == 1
    buff[i++] = name.length >> 16           // unsigned char nameLengthB2
    buff[i++] = name.length >> 8            // unsigned char nameLengthB1
    buff[i++] = name.length                 // unsigned char nameLengthB0
  }
  else {
    buff[i++] = name.length                 // unsigned char nameLengthB0   // nameLengthB0  >> 7 == 0
  }
  
  if(valueByteLength == 4) {
    buff[i++] = value.length >> 24 | 1 << 7 // unsigned char valueLengthB3  // valueLengthB3 >> 7 == 1
    buff[i++] = value.length >> 16          // unsigned char valueLengthB2
    buff[i++] = value.length >> 8           // unsigned char valueLengthB1
    buff[i++] = value.length                // unsigned char valueLengthB0
  }
  else {
    buff[i++] = value.length                // unsigned char valueLengthB0  // valueLengthB0 >> 7 == 0
  }
  
  i += buff.write(name, i)                  // unsigned char nameData[nameLength]
  i += buff.write(value, i)                 // unsigned char valueData[valueLength]
  
  return buff
}

