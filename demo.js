'use strict'

var parser = require('xml2js').parseString;
var sscanf = require('scanf').sscanf;
var schedule = require("node-schedule");
const log4js  = require('log4js')
const Padchat = require('./index')
const fs      = require('fs')
const util    = require('util')
const qrcode  = require('qrcode-terminal')
var cluster = require('cluster');//加载clustr模块


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
var worksQueue = []
var historyWroksCount = 0


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
     
function GetChinese(strValue) {  
    if(strValue!= null && strValue!= ""){  
        var reg = /[\u4e00-\u9fa5]/g;   
        return strValue.match(reg).join("");  
    }  
    else  
        return "";  
}  

function FindMinCount(linkcountvec) {  
	var minCount=99999999;  
	for (var i=1;i<linkcountvec.length;i++)  
	{  
		if(linkcountvec[i].count<minCount)  
		{  
			minCount=linkcountvec[i].count;  
		}  
	}  
	return minCount
}

async function UserMsgFilter(data) {
	logger.info('开始解析指令');
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
			if(err) logger.info('写文件操作失败');
			else logger.info('写文件操作成功');
		});
	}
	
	if(selfid == userid)
		return;

	if(!isUserMsg)
		return;
	logger.info('审核权限');
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
			wx.sendMsg(userid,'你与机器人以聊天的方式进行交互。 \n命令格式：\n命令 前n条发链接送给 群1,群2,群3 间隔3分钟\n命令 前n条发链接送给 群聊01-10 间隔3分钟 \n输入\t查看所有任务\n查看将要执行的所有任务。\n输入\t清空所有任务\n取消掉将要执行的所有任务。\n输入\t 模版  获得标准的命令例子 ',[])
		}
		else if(content == "模版")
		{
			wx.sendMsg(userid,'命令 前n条发链接送给 群1,群2,群3 间隔3分钟\n命令 前n条发链接送给 群聊01-10 间隔3分钟',[])
		}
		else if(content.indexOf("查看所有任务") == 0)
		{
			wx.sendMsg(userid,'发送转发总数 ' + historyWroksCount + "\n队列中还有" + worksQueue.length + "个任务。",[])
		}
		else if(content == "清空所有任务")
		{
			worksQueue= []
			wx.sendMsg(userid, ' 清空所有任务成功！',[])
		}
		else 
		{
			content = content.trim()
			content = content.replace("  "," ");   
			var argv = content.split(" ");
			if(argv[0] != "命令" || argv.length != 4)
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
			
			
			var charrooms ;
			logger.info("聊天室名字类型", typeof(argv[2]))
			if(argv[2].indexOf(',')>-1)
			{
				logger.info("聊天室逗号模式分割")
				charrooms = argv[2].split(",")	
			}	
			else if(argv[2].indexOf('-')>-1)
			{
				logger.info("聊天室格式化分割")
				
				charrooms = []
				var fmtsplit = argv[2].split("-")
				
				
				var min = Number(fmtsplit[0].replace(/[^0-9]/ig,""))
				var tmphead = fmtsplit[0]
				var max = Number(fmtsplit[1])
				var roomhead = GetChinese(fmtsplit[0])
				for(var i = min; i <= max; i++)
				{
					var roomindex = ''
					if(i<10) roomindex += '0'
					roomindex +=i.toString()
					logger.info(roomindex)
					charrooms.push(roomhead+roomindex)
				}
			}
			else
			{
				logger.info("聊天室默认分割")
				charrooms = []
				charrooms.push(argv[2])
			}
				
			
			// 初始化参数
			var intervalSecond = 60
			var intervalSecond_match = argv[3].match(/\d+\.?\d*/);
			intervalSecond = parseFloat(intervalSecond_match[0] * 60); 
			
			
			if(presize <= 0 || charrooms.length < 1 || intervalSecond < 0)
			{
				wx.sendMsg(userid,presize+charrooms.length+intervalSecond+'无效的输入，请按正确的格式输入！\n回复帮助获取帮助。\n回复模版获取模版',[])
				return;
			}
			
			
			var linksize = Math.min(presize,userStack[userid].length)
			var sleeptime = 5000;
			var offsettime = intervalSecond * 1000 - sleeptime * linksize;
			if(offsettime < 0) offsettime = 0;
			logger.info("间隔时间：", offsettime)
			
			if(linksize < 1)
			{
				wx.sendMsg(userid,'您录入的链接数量小于1 ，请录入后重新执行命令！',[])
				return
			}
			
			// 初始化 当前链接数组
			var curlinkvec = []
			for(var j = 0; j < linksize; j++)
			{
				curlinkvec.push(userStack[userid].pop())
			}
			logger.info('连接数量',linksize)
			
			// 全局连接索引列表，记录连接的转发次数
			var linkcountvec = []
			for(var j = 0; j < linksize; j++)
			{
				var linkcount = {};
				linkcount.index = j;
				linkcount.count = 0;
				linkcountvec.push(linkcount)
			}
			logger.info('全局连接索引列表',linkcountvec)
			
			// 每个聊天室设置保存一个链接列表，记录连接的转发次数
			var charoomlinkcountvec = {}
			for(var i = 0; i<charrooms.length; i++)
			{
				var tmpvec = []
				for(var j = 0; j < linksize; j++)
				{
					var chartroomlinkcount  = {};
					chartroomlinkcount.index = j;
					chartroomlinkcount.count = 0;
					tmpvec.push(chartroomlinkcount)
				}
				charoomlinkcountvec[charrooms[i]] = tmpvec
			}
			logger.info('聊天室连接索引列表',charoomlinkcountvec)

			if (!Array.prototype.shuffle) {
					Array.prototype.shuffle = function() {
						for(var j, x, i = this.length; i; j = parseInt(Math.random() * i), x = this[--i], this[i] = this[j], this[j] = x);
						return this;
					};
			}
			
			var now = new Date
			for(var linkstep = 0; linkstep < linksize; linkstep++)
			{
				for(var i=0; i<charrooms.length; i++)
				{
					var chartroom = charrooms[i]
					var chartroomid = nickname2userid[chartroom]
					if(chartroomid === undefined)
					{
						logger.info('没找到聊天室：' + chartroom+' 请用其他微信号在群里发言后再试！')
						wx.sendMsg(userid,'没找到聊天室：' + chartroom+' 请用其他微信号在群里发言后再试！',[])
						return
					}
					
					
					linkcountvec.shuffle();
					// 找出全局连接数组中最小的
					var minCount=FindMinCount(linkcountvec);  
					
					// 找出全局数组中最小的几个
					var minlinkvec = []
					for(var j = 0; j < linkcountvec.length; j++)
					{
						if(linkcountvec[j].count <= minCount)
						{
							minlinkvec.push(linkcountvec[j])
						}
					}
					
					var jsonstr
					var chartroommincount = FindMinCount(charoomlinkcountvec[chartroom])
					var isfindminlink = false
					for(var j = 0; j < minlinkvec.length; j++)
					{
						for(var k = 0; k < charoomlinkcountvec[chartroom].length; k++)
						{
							if(charoomlinkcountvec[chartroom][k].count <= chartroommincount
								&&minlinkvec[j].index == charoomlinkcountvec[chartroom][k].index)
							{
								jsonstr = curlinkvec[minlinkvec[j].index]
								parser(jsonstr, function (err, result) {  jsonstr = JSON.stringify(result); });
								minlinkvec[j].count++;
								charoomlinkcountvec[chartroom][k].count++;
								isfindminlink = true
								break
							}
						}
						if(isfindminlink == true)
							break
					}
					
					
					var msgobj = JSON.parse(jsonstr).msg.appmsg[0]; 
					var finish = false
					if(i ==  charrooms.length -1 && linkstep == linksize -1)
						finish = true
					

					
					
					logger.info("发布任务", chartroom, now.pattern("yyyy-MM-dd HH:mm:ss"), msgobj.title);

					var workinfo = {}	
					workinfo.userid = userid
					workinfo.starttime = now
					workinfo.chartroom = chartroom
					workinfo.chartroomid = chartroomid
					workinfo.msg = msgobj
					workinfo.finish = finish
					workinfo.sleeptime = 0
					if(charrooms.length-1 == i && i!=0 && linkstep!=linksize-1)
						workinfo.sleeptime = offsettime
					
					
					worksQueue.push(workinfo)
					historyWroksCount++;
				}
			}
			var curworkslength = linksize*charrooms.length
			wx.sendMsg(userid, "您转发了" +linksize + "条链接到"+charrooms.length+"个聊天室。\n一共"+ curworkslength +"条任务。\n队列前还有" + (worksQueue.length-curworkslength)+"条任务。", [])
		}
    }
}


async function UserRichMedia(data) {
	logger.info('收到app链接')
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
	logger.info('审核权限')
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



function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}


async function test() 
{
	
	var workscount = 0;
	var stopcount = 20 + Math.ceil(Math.random()*10);
	var stoptime = 3*1000*60
	while(true)
	{
		if(worksQueue.length>0)
		{
			var interval = 5000
			workscount++;
			var curwork = worksQueue.shift()
			
			logger.info("执行任务", curwork.chartroom, curwork.chartroomid, curwork.starttime, worksQueue.length, curwork.msg.title, workscount)
			await wx.sendAppMsg(curwork.chartroomid, curwork.msg)
			if(curwork.finish)
				wx.sendMsg(curwork.userid,"此命令执行完毕！\n任务发布时间：\n" + JSON.stringify(curwork.starttime)  ,[])
			
			
			var randomtime = Math.ceil(Math.random()*4000)
			interval = interval - randomtime/2 + randomtime
			if(curwork.sleeptime)
			{
				logger.info("完成一次群发，停止" + curwork.sleeptime/1000/60 + "分钟！")
				await sleep(curwork.sleeptime);
			}
			
			await sleep(interval);
			
			if(workscount%stopcount == 0)
			{
				logger.info("执行满" + stopcount + "个停止" + stoptime/1000/60 + "分钟！")
				await sleep(stoptime);
				stopcount = 20 + Math.ceil(Math.random()*10);
			}
		}

		await sleep(Math.ceil(Math.random()*200));
	}
}

test()
 
 