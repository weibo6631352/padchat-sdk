
'use strict'
const log4js = require('log4js')
const logger = log4js.getLogger('app')

async function UserMsgFilter(data) {
    const content = data.content
    const username = data.fromUser

    // 判断聊天室是否需要监控
   // if (username == "1370217605@chatroom") {
        logger.info(data)
   // }

}



exports.UserMsgFilter = UserMsgFilter;