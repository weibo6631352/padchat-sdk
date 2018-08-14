'use strict'

var parser = require('xml2js').parseString;
var sscanf = require('scanf').sscanf;
var schedule = require("node-schedule");
const log4js  = require('log4js')
const Padchat = require('./index')
const fs      = require('fs')
const util    = require('util')
const qrcode  = require('qrcode-terminal')



/**
* 创建日志目录
*/

try {
  require('fs').mkdirSync('./logs')
} catch (e) {
  if (e.code !== 'EEXIST') {
    console.error('Could not set up log directory, error: ', e)
    process.exit(1)
  }
}

try {
  log4js.configure('./log4js.json')
} catch (e) {
  console.error('载入log4js日志输出配置错误: ', e)
  process.exit(1);
}

const logger = log4js.getLogger('app')
const dLog   = log4js.getLogger('dev')

logger.info('demo start!')

const autoData = {
  wxData: '',
  token : '',
}
let server = ''
    server = 'ws://127.0.0.1:7777'
    server = 'ws://52.80.34.207:7777'

try {
  const tmpBuf          = fs.readFileSync('./config.json')
  const data            = JSON.parse(String(tmpBuf))
        autoData.wxData = data.wxData
        autoData.token  = data.token
  logger.info('载入设备参数与自动登陆数据：%o ', autoData)
} catch (e) {
  logger.warn('没有在本地发现设备登录参数或解析数据失败！如首次登录请忽略！')
}

const wx = new Padchat(server)
logger.info('当前连接接口服务器为：', server)
let disconnectCount = 0      // 断开计数
let connected       = false  // 成功连接标志

var nickname2userid = {}
var userid2nickname = {}

wx
  .on('close', (code, msg) => {
    logger.info(`Websocket已关闭！code: ${code} - ${msg}`)
    // 根据是否成功连接过判断本次是未能连接成功还是与服务器连接中断
    if (connected) {
      connected = false
      disconnectCount++
      logger.info(`第 ${disconnectCount} 次与服务器连接断开！现在将重试连接服务器。`)
    } else {
      logger.debug(`未能连接服务器！将重试连接服务器。`)
    }
    // 重新启动websocket连接
    wx.start()
  })
  .on('open', async () => {
    let ret
    logger.info('连接成功!')
    connected = true

    // 非首次登录时最好使用以前成功登录时使用的设备参数，
    // 否则可能会被tx服务器怀疑账号被盗，导致手机端被登出
    ret = await wx.init()
    if (!ret.success) {
      logger.error('新建任务失败！', ret)
      return
    }
    //logger.info('新建任务成功, json: ', ret)

    //先尝试使用断线重连方式登陆
    if (autoData.token) {
      ret = await wx.login('token', autoData)
      if (ret.success) {
        //logger.info('断线重连请求成功！', ret)
        return
      }
      logger.warn('断线重连请求失败！', ret)

      ret = await wx.login('request', autoData)
      if (ret.success) {
        logger.info('自动登录请求成功！', ret)
        return
      }
      logger.warn('自动登录请求失败！', ret)
    }

    ret = await wx.login('qrcode')
    if (!ret.success) {
      logger.error('使用qrcode登录模式失败！', ret)
      return
    }
    logger.info('使用qrcode登录模式！')
  })
  .on('qrcode', data => {
    // 如果存在url，则直接在终端中生成二维码并显示
    if (data.url) {
      logger.info(`登陆二维码内容为: "${data.url}"，请使用微信扫描下方二维码登陆!`)
      qrcode.generate(data.url, { small: false })
    } else {
      logger.error(`未能获得登陆二维码!`)
    }
  })
  .on('scan', data => {
    switch (data.status) {
      case 0:
        logger.info('等待扫码...', data)
        break;
      case 1:
        // {
        //   status     : 1,
        //   expiredTime: 239,
        //   headUrl    : 'http://wx.qlogo.cn/mmhead/ver_1/xxxxxxx/0', //头像url
        //   nickName   : '木匠' //昵称
        // }
        logger.info('已扫码，请在手机端确认登陆...', data)
        break;
      case 2:
        // {
        //   password   : '***hide***',   // 可忽略
        //   status     : 2,
        //   expiredTime: 238,
        //   headUrl    : 'http://wx.qlogo.cn/mmhead/ver_1/xxxxxxx/0',  //头像url
        //   subStatus  : 0               // 登陆操作状态码
        //   以下字段仅在登录成功时有效
        //   external   : '1',
        //   email      : '',
        //   uin        : 149806460,      // 微信账号uin，全局唯一
        //   deviceType : 'android',      // 登陆的主设备类型
        //   nickName   : '木匠'          //昵称
        //   userName   : 'wxid_xxxxxx',  // 微信账号id，全局唯一
        //   phoneNumber: '18012345678',  // 微信账号绑定的手机号
        // }
        switch (data.subStatus) {
          case 0:
            logger.info('扫码成功！登陆成功！', data)
            break;
          case 1:
            logger.info('扫码成功！登陆失败！', data)
            break;
          default:
            logger.info('扫码成功！未知状态码！', data)
            break;
        }
        break;
      // 如果等待登陆超时或手机上点击了取消登陆，需要重新调用登陆
      case 3:
        logger.info('二维码已过期！请重新调用登陆接口！', data)
        break;
      case 4:
        logger.info('手机端已取消登陆！请重新调用登陆接口！', data)
        break;
      default:
        logger.warn('未知登陆状态！请重新调用登陆接口！', data)
        break;
    }
  })
  .on('login', async () => {
    logger.info('微信账号登陆成功！')
	


    let ret

    ret = await wx.getMyInfo()
    logger.info('当前账号信息：', ret.data)

    // 主动同步通讯录
    await wx.syncContact()
	selfid = ret.data.userName
	
	// 读本地缓存
	nickname2userid = JSON.parse(fs.readFileSync(selfid+'.txt'))
	for(var key in nickname2userid){
		userid2nickname[nickname2userid[key]] = key
　　}
	logger.info('读取本地缓存成功！')


    if (!autoData.wxData) {
      // 如果已经存在设备参数，则不再获取
      ret = await wx.getWxData()
      if (!ret.success) {
        logger.warn('获取设备参数未成功！ json:', ret)
        return
      }
      logger.info('获取设备参数成功, json: ', ret)
      Object.assign(autoData, { wxData: ret.data.wxData })
    }

    ret = await wx.getLoginToken()
    if (!ret.success) {
      //logger.warn('获取自动登陆数据未成功！ json:', ret)
      return
    }
    //logger.info('获取自动登陆数据成功, json: ', ret)
    Object.assign(autoData, { token: ret.data.token })

    // NOTE: 这里将设备参数保存到本地，以后再次登录此账号时提供相同参数
    fs.writeFileSync('./config.json', JSON.stringify(autoData, null, 2))
    logger.info('设备参数已写入到 ./config.json文件')
  })
  .on('logout', ({ msg }) => {
    logger.info('微信账号已退出！', msg)
  })
  .on('over', ({ msg }) => {
    logger.info('任务实例已关闭！', msg)
  })
  .on('loaded', async () => {
    //logger.info('通讯录同步完毕！')

    // 主动触发同步消息
    await wx.syncMsg()

    const ret = await wx.sendMsg('filehelper', '你登录了！')
    //logger.info('发送信息结果：', ret)
  })
  .on('sns', (data, msg) => {
    logger.info('收到朋友圈事件！请查看朋友圈新消息哦！', msg)
  })
  .on('push', async data => {
    // 消息类型 data.mType
    // 1  文字消息
    // 2  好友信息推送，包含好友，群，公众号信息
    // 3  收到图片消息
    // 34  语音消息
    // 35  用户头像buf
    // 37  收到好友请求消息
    // 42  名片消息
    // 43  视频消息
    // 47  表情消息
    // 48  定位消息
    // 49  APP消息(文件 或者 链接 H5)
    // 50  语音通话
    // 51  状态通知（如打开与好友/群的聊天界面）
    // 52  语音通话通知
    // 53  语音通话邀请
    // 62  小视频
    // 2000  转账消息
    // 2001  收到红包消息
    // 3000  群邀请
    // 9999  系统通知
    // 10000  微信通知信息. 微信群信息变更通知，多为群名修改，进群，离群信息，不包含群内聊天信息
    // 10002  撤回消息
    // --------------------------------
    // 注意，如果是来自微信群的消息，data.content字段中包含发言人的wxid及其发言内容，需要自行提取
    // 各类复杂消息，data.content中是xml格式的文本内容，需要自行从中提取各类数据。（如好友请求）
    if ((data.mType !== 2) && !(data.mType === 10002 && data.fromUser === 'weixin')) {
      // 输出除联系人以外的推送信息
      dLog.info('push: \n%o', data)
    }
    let rawFile
    switch (data.mType) {
      case 2:
		nickname2userid[data.nickName] = data.userName
		userid2nickname[data.userName] = data.nickName
        logger.info('收到推送联系人1111：%s - %s', data.userName, data.nickName)
        break

      case 3:
        //logger.info('收到来自 %s 的图片消息，包含图片数据：%s，xml内容：\n%s', data.fromUser, !!data.data, data.content)
        //rawFile = data.data || null
        //logger.info('图片缩略图数据base64尺寸：%d', rawFile.length)
        //await wx.getMsgImage(data)
        //  .then(ret => {
        //    rawFile = ret.data.image || ''
        //    logger.info('获取消息原始图片结果：%s, 获得图片base64尺寸：%d', ret.success, rawFile.length)
        //  })
        //logger.info('图片数据base64尺寸：%d', rawFile.length)
        //await wx.sendImage('undifne', rawFile)
        //  .then(ret => {
        //    logger.info('转发图片信息给 %s 结果：', 'undifne', ret)
        //  })
        //  .catch(e => {
        //    logger.warn('转发图片信息异常:', e.message)
        //  })
        break

      case 43:
        //logger.info('收到来自 %s 的视频消息，包含视频数据：%s，xml内容：\n%s', data.fromUser, !!data.data, data.content)
        //rawFile = data.data || null
        //if (!rawFile) {
        //  await wx.getMsgVideo(data)
        //    .then(ret => {
        //      rawFile = ret.data.video || ''
        //      logger.info('获取消息原始视频结果：%s, 获得视频base64尺寸：%d', ret.success, rawFile.length)
        //    })
        //}
        //logger.info('视频数据base64尺寸：%d', rawFile.length)
        break

      case 1:
        if (data.fromUser === 'newsapp') { // 腾讯新闻发的信息太长
          break
        }
        logger.info('收到来自 %s 的文本消息：', data.fromUser, data.description || data.content)
        await UserMsgFilter(data)
        if (/ding/.test(data.content)) {
          await wx.sendMsg(data.fromUser, 'dong. receive:' + data.content)
            .then(ret => {
              logger.info('回复信息给%s 结果：', data.fromUser, ret)
            })
            .catch(e => {
              logger.warn('回复信息异常:', e.message)
            })
        } else if (/^#.*/.test(data.content) || /^[\w]*:\n#.*/.test(data.content)) {
          await onMsg(data)
            .catch(e => {
              logger.warn('处理信息异常：', e)
            })
        }
        break

      case 34:
        //logger.info('收到来自 %s 的语音消息，包含语音数据：%s，xml内容：\n%s', data.fromUser, !!data.data, data.content)
        //// 超过30Kb的语音数据不会包含在推送信息中，需要主动拉取
        //rawFile = data.data || null
        //if (!rawFile) {
        //  // BUG: 超过60Kb的语音数据，只能拉取到60Kb，也就是说大约36~40秒以上的语音会丢失后边部分语音内容
        //  await wx.getMsgVoice(data)
        //    .then(ret => {
        //      rawFile = ret.data.voice || ''
        //      logger.info('获取消息原始语音结果：%s, 获得语音base64尺寸：%d，拉取到数据尺寸：%d', ret.success, rawFile.length, ret.data.size)
        //    })
        //}
        //logger.info('语音数据base64尺寸：%d', rawFile.length)
        //if (rawFile.length > 0) {
        //  let   match  = data.content.match(/length="(\d+)"/) || []
        //  const length = match[1] || 0
        //        match  = data.content.match(/voicelength="(\d+)"/) || []
        //  const ms     = match[1] || 0
        //  logger.info('语音数据语音长度：%d ms，xml内记录尺寸：%d', ms, length)

          //await wx.sendVoice('filehelper', rawFile, ms)
          //  .then(ret => {
          //    logger.info('转发语音信息给 %s 结果：', 'filehelper', ret)
          //  })
          //  .catch(e => {
          //    logger.warn('转发语音信息异常:', e.message)
          //  })
        //}
        break

      case 49:

        if (data.content.indexOf('<![CDATA[微信红包]]>') > 0) {
          logger.info('收到来自 %s 的红包：', data.fromUser, data)
          await wx.queryRedPacket(data)
            .then(ret => {
              logger.info('未领取，查询来自 %s 的红包信息：', data.fromUser, ret)
            })
            .catch(e => {
              logger.warn('未领取，查询红包异常:', e.message)
            })
          await wx.receiveRedPacket(data)
            .then(async ret => {
              logger.info('接收来自 %s 的红包结果：', data.fromUser, ret)
              await wx.openRedPacket(data, ret.data.key)
                .then(ret2 => {
                  logger.info('打开来自 %s 的红包结果：', data.fromUser, ret2)
                })
                .catch(e => {
                  logger.warn('打开红包异常:', e.message)
                })
              await wx.queryRedPacket(data)
                .then(ret => {
                  logger.info('打开后，查询来自 %s 的红包信息：', data.fromUser, ret)
                })
                .catch(e => {
                  logger.warn('打开后，再次查询红包异常:', e.message)
                })
            })
            .catch(e => {
              logger.warn('接收红包异常:', e.message)
            })
        } else if (data.content.indexOf('<![CDATA[微信转账]]>') > 0) 
		{
          logger.info('收到来自 %s 的转账：', data.fromUser, data)
          await wx.queryTransfer(data)
            .then(ret => {
              logger.info('查询来自 %s 的转账信息：', data.fromUser, ret)
            })
            .catch(e => {
              logger.warn('查询转账异常:', e.message)
            })
          await wx.acceptTransfer(data)
            .then(ret => {
              logger.info('接受来自 %s 的转账结果：', data.fromUser, ret)
            })
            .catch(e => {
              logger.warn('接受转账异常:', e.message)
            })
          await wx.queryTransfer(data)
            .then(ret => {
              logger.info('接受后，查询来自 %s 的转账信息：', data.fromUser, ret)
            })
            .catch(e => {
              logger.warn('接受后，查询转账异常:', e.message)
            })
        } 
		else 
		{
		  await UserRichMedia(data)
          //logger.info('收到一条来自 %s 的appmsg富媒体消息：', data.fromUser, data)
        }
        break

      case 10002:
        if (data.fromUser === 'weixin') {
          //每次登陆，会收到一条系统垃圾推送，过滤掉
          break
        }
        logger.info('用户 %s 撤回了一条消息：', data.fromUser, data)
        break

      default:
        //logger.info('收到推送消息：', data)
        break
    }
  })
  .on('error', e => {
    logger.error('ws 错误:', e.message)
  })
  .on('warn', e => {
    logger.error('任务出现错误:', e.message)
  })
  .on('cmdRet', (cmd, ret) => {
    //捕捉接口操作结果，补充接口文档用
    dLog.info('%s ret: \n%s', cmd, util.inspect(ret, { depth: 10 }))
  })

async function onMsg(data) {
  const content        = data.content.replace(/^[\w:\n]*#/m, '')
  let   [cmd, ...args] = content.split('\n')

  args = args.map(str => {
    try {
      str = JSON.parse(str)
    } catch (e) {
    }
    return str
  })
  if (cmd && wx[cmd] && typeof wx[cmd] === 'function') {
    logger.info('执行函数 %s，参数：', cmd, args)
    await wx[cmd](...args)
      .then(ret => {
        logger.info('执行函数 %s 结果：%o', cmd, ret)
      })
      .catch(e => {
        logger.warn('执行函数 %s 异常：', e)
      })
  }
}
process.on('uncaughtException', e => {
  logger.error('Main', 'uncaughtException:', e)
})

process.on('unhandledRejection', e => {
  logger.error('Main', 'unhandledRejection:', e)
})













//////我的代码//////////

var selfid = ''
var users = []
var userStack = {}  // 推送队列
var chartroomStack = {}
var chartroomCount = {}


Date.prototype.pattern=function(fmt) {         
    var o = {         
    "M+" : this.getMonth()+1, //月份         
    "d+" : this.getDate(), //日         
    "h+" : this.getHours()%12 == 0 ? 12 : this.getHours()%12, //小时         
    "H+" : this.getHours(), //小时         
    "m+" : this.getMinutes(), //分         
    "s+" : this.getSeconds(), //秒         
    "q+" : Math.floor((this.getMonth()+3)/3), //季度         
    "S" : this.getMilliseconds() //毫秒         
    };         
    var week = {         
    "0" : "/u65e5",         
    "1" : "/u4e00",         
    "2" : "/u4e8c",         
    "3" : "/u4e09",         
    "4" : "/u56db",         
    "5" : "/u4e94",         
    "6" : "/u516d"        
    };         
    if(/(y+)/.test(fmt)){         
        fmt=fmt.replace(RegExp.$1, (this.getFullYear()+"").substr(4 - RegExp.$1.length));         
    }         
    if(/(E+)/.test(fmt)){         
        fmt=fmt.replace(RegExp.$1, ((RegExp.$1.length>1) ? (RegExp.$1.length>2 ? "/u661f/u671f" : "/u5468") : "")+week[this.getDay()+""]);         
    }         
    for(var k in o){         
        if(new RegExp("("+ k +")").test(fmt)){         
            fmt = fmt.replace(RegExp.$1, (RegExp.$1.length==1) ? (o[k]) : (("00"+ o[k]).substr((""+ o[k]).length)));         
        }         
    }         
    return fmt;         
}       
     

async function UserMsgFilter(data) {
	var userid = data.fromUser
	var contact = await wx.getContact(userid)
	var nickName = contact.data.nickName
	var isUserMsg = !("chatroomOwner" in contact.data)
	var content = data.content

	// 如果userid不在缓存中，则把更新缓存，并且保存到本地
	if(!(userid in userid2nickname))
	{
		nickname2userid[nickName] = userid
		userid2nickname[userid] = nickName
		fs.writeFile(selfid+'.txt', JSON.stringify(nickname2userid),function(err){
			if(err) console.log('写文件操作失败');
			else console.log('写文件操作成功');
		});
	}
	
	if(selfid == userid)
		return;
	
	if(!isUserMsg)
		return;
	if(content == "申请管理员"){
		if(users.indexOf(userid) > -1){
			wx.sendMsg(userid,'您已经是管理员！',[])
		}
		else{
			users.push(userid)
			wx.sendMsg(userid, '申请成功！',[])
		}
		return;
	}

    // 判断消息来源
    if (users.indexOf(userid) > -1) {
        if(content == "帮助")
		{
			wx.sendMsg(userid,'你的微信号与机器人微信号以聊天的方式进行交互，命令的格式要与上边图片的一致，否则可能不认识。 \n命令格式：命令 前n条发链接送给 群1、群2、群3 间隔3分钟 立即 否 \n选项：\n*立即：有其他任务正在执行，是否可以马上执行此任务。  否则排队等待其他任务执行完毕。 \n输入\t查看群内任务 群名称\n查看群内将要执行的所有任务。\n输入\t清空群内任务 群名称\n取消群内掉将要执行的所有任务。\n输入\t 模版  获得标准的命令例子 ',[])
		}
		else if(content == "模版")
		{
			wx.sendMsg(userid,'命令 前n条链接发送给 群1、群2、群3 间隔3分钟 立即 否',[])
		}
		else if(content.indexOf("查看群内任务") == 0)
		{
			var spt = content.split(" ")
			if(spt.length == 2)
			{
				var chartroom = spt[1];
				if(nickname2userid[chartroom] === undefined)
				{
					wx.sendMsg(userid,'没找到聊天室：' + chartroom+' 请用其他微信号在群里发言后再试！',[])
					return
				}
				
				var splitstr = ""
				for(var i = 0; i < chartroomStack[chartroom].length; i++)
				{
					//logger.info(Object.keys(chartroomStack[chartroom][i])[0],tmpdate.pattern("yyyy-MM-dd HH:mm:ss"))
					splitstr += i + ' ' + JSON.stringify(new Date(parseInt(Object.keys(chartroomStack[chartroom][i])[0]))) + "\n"
				}
				
				splitstr+='发送转发总数 ' + chartroomCount[chartroom]
				wx.sendMsg(userid,splitstr,[])
			}
		}
		else if(content.indexOf("清空群内任务") == 0)
		{
			var spt = content.split(" ")
			if(spt.length == 2)
			{
				var chartroom = spt[1];
				if(nickname2userid[chartroom] === undefined)
				{
					wx.sendMsg(userid,'没找到聊天室：' + chartroom+' 请用其他微信号在群里发言后再试！',[])
					return
				}
				for(var i = 0; i < chartroomStack[chartroom].length; i++)
				{
					chartroomStack[chartroom][i][Object.keys(chartroomStack[chartroom][i])[0]].cancel();
				}
				chartroomStack[chartroom] = []
				wx.sendMsg(userid, chartroom + ' 清空群内任务成功！',[])
			}
		}
		else 
		{
			content = content.trim()
			content = content.replace("  "," ");   
			var argv = content.split(" ");
			if(argv[0] != "命令" || argv.length != 6)
			{
				wx.sendMsg(userid,'无效的输入，请按正确的格式输入！\n回复帮助获取帮助。\n回复模版获取模版',[])
				return;
			}
			if (userStack[userid]===undefined) {
				wx.sendMsg(userid,'请先录入链接，再执行命令！',[])
				return;
			}
			var head = argv[0]
			var presize = Number(argv[1].replace(/[^0-9]/ig,""));   	// int
			var charrooms = argv[2].split("、")						

			
			var intervalSecond = 60
			var intervalSecond_match = argv[3].match(/\d+\.?\d*/);
			intervalSecond = parseFloat(intervalSecond_match[0] * 60); 
			
			var quick = argv[5] == "是"									// bool
			
			if(presize <= 0 || charrooms.length < 1 || intervalSecond < 0)
			{
				wx.sendMsg(userid,'无效的输入，请按正确的格式输入！\n回复帮助获取帮助。\n回复模版获取模版',[])
				return;
			}
			
			var cur = new Date();
			cur.setSeconds(cur.getSeconds() + 3)
			logger.info(cur.pattern("yyyy-MM-dd HH:mm:ss"))
			
			
			var roomstarts = []
			for(let j = 0; j < charrooms.length; j++)
			{
				var chartroom = charrooms[j]
				if (chartroomStack[chartroom]===undefined) {
						chartroomStack[chartroom] = []
				}
				if (chartroomCount[chartroom]===undefined) {
						chartroomCount[chartroom] = 0
				}
				
				if(chartroomStack[chartroom].length > 0){
					var predate = new Date(parseInt(Object.keys(chartroomStack[chartroom][chartroomStack[chartroom].length-1])[0]))
					if(!quick && predate.getTime() > cur.getTime()  )
					{
						logger.info(chartroom, '任务推迟到：',  predate)
						roomstarts.push(predate)
					}else{
						roomstarts.push(cur)
					}
				}
				else{
						roomstarts.push(cur)
				}
			}

			
			var userStackUseridLength = userStack[userid].length;
			var i=0
			for(i=0;i<presize && userStackUseridLength > 0 ;i++)
			{
				var jsonstr = userStack[userid][userStack[userid].length-1]
				parser(jsonstr, function (err, result) {  jsonstr = JSON.stringify(result); });
				var msgobj = JSON.parse(jsonstr).msg.appmsg[0]; 
				
				for(let j = 0; j < charrooms.length; j++)
				{
					var starttime =  new Date(roomstarts[j].getTime() + (i * intervalSecond) * 1000);
					logger.info(starttime)
					
					var fins = false
					if( (i == presize -1 || userStackUseridLength == 1)  && j ==  charrooms.length -1 )
						fins = true

					!function(now,curmsg, finsin){ 
						var chartroom = charrooms[j]
						var jobinfo = {}	
						jobinfo[now.getTime()] = schedule.scheduleJob(now, function(f){
							var time = f.getTime()
							logger.info("执行任务", chartroom, time)
							
							
							var index = -1
							var removejob = {};
							for(var i = 0; i < chartroomStack[chartroom].length; i++)
							{
								if(Object.keys(chartroomStack[chartroom][i])[0] == time)
								{
									removejob [time] = chartroomStack[chartroom][i][time]
									index = i;
								}
							}
							
							if(-1 != index)
							{
								logger.info("完成任务", chartroom, time)
								chartroomStack[chartroom].splice(index,1);
							}
								
							
							if(nickname2userid[chartroom] === undefined)
							{
								wx.sendMsg(userid,'没找到聊天室：' + chartroom+' 请用其他微信号在群里发言后再试！',[])
								return
							}
							
							var charroomid = nickname2userid[chartroom]
							wx.sendAppMsg(charroomid, curmsg)
							
							if(finsin)
								wx.sendMsg(userid,"此命令执行完毕！\n" + JSON.stringify(new Date(time)),[])
						});
						
						chartroomStack[chartroom].push(jobinfo)
					}(starttime, msgobj, fins);
					
					chartroomCount[chartroom]++;
				}
				userStack[userid].pop()
				userStackUseridLength = userStack[userid].length;
			}
			wx.sendMsg(userid, "您定时转发了" +i + "条链接！",[])
		}
    }
}


async function UserRichMedia(data) {
	var userid = data.fromUser
	var contact = await wx.getContact(userid)
	var nickName = contact.data.nickName
	var isUserMsg = !("chatroomOwner" in contact.data)
	var content = data.content
	
	if(selfid == userid)
		return;
	
	if(!isUserMsg)
	{
		return;
	}
	
	// 判断消息来源
	if (users.indexOf(userid) > -1) {
		if (userStack[userid]===undefined) {
			userStack[userid] = []
		}
			
		if(userStack[userid].length >= 1024)
		{
			userStack[userid].shift()
		}
		userStack[userid].push(content)
		logger.info('录入成功！')
	}
}

