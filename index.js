const postbacks = require('./src/postbacks');
const andybot = require('./src/andybot');
const activities = require('./src/activities.json');

const TriviaHandler = require('./src/trivia');
const PollHandler = require('./src/poll');
const utils = require('./utils');
const config = require('./src/config');
const activityHandlers = {
	trivia: TriviaHandler,
	poll: PollHandler
};

const _ = require('lodash');

let eventHandlers = {};

let getStarted;

module.exports = function (bp) {

	function isValidActivityType(activityType) {
		const validActivityTypes = ['poll', 'trivia', 'scavengerhunt'];
		return validActivityTypes.indexOf(activityType);
	};
	
	function getActivityType(activityId) {
		if (activityId.indexOf('-') < 0) {
			throw new Error('Invalid activity name');
		}
		const split = activityId.split('-');
		return split[0];
	};

	getStarted = async function (event, next) {

		try {
			const pageId = event.user.id;
			const exists = await andybot.userExists(pageId);
			if (exists === false) {
				event.reply('#welcome');
				andybot.createUser(pageId, event.user.first_name);
			} else {
				const user = await andybot.getUser(pageId);
				event.reply('#welcome-back', { user });
			}

			// Get Started may have an associated event.
			let referral;
			if (utils.isNonNull(event.raw.referral)) {
				referral = event.raw.referral;
			} else if (utils.isNonNull(event.raw.postback) && utils.isNonNull(event.raw.postback.referral)) {
				referral = event.raw.postback.referral;
			}

			if (utils.isNonNull(referral)) {
				await handleScan(referral, event);
			}
		} catch (err){
			console.error(err);
			event.reply('#error');
		}
	}

	async function howToPlay(event, next){

		const howtoplay = activities['howtoplay'];

		event.reply('#how_to_play', { howtoplay });
		return;
	}

	async function prizes(event, next) {
		event.reply('#prizes');
		return;
	}

	async function sendScavengerHuntHint(event, next) {
		const clueNumber = event.raw.postback.payload.split(':')[1];		
		const hintResponse = await andybot.scavengerhunt.getHint(clueNumber);
		event.reply("#scavengerhunt-hint", { hint: hintResponse.hint });
		return;
	}
	
	async function startActivity(event, next) {
		const activityName = event.raw.postback.payload.split(':')[1];		
		const activityType = getActivityType(activityName);
		if (isValidActivityType(activityType) === false) {
			event.reply('#error');
		}
	
		if (bp.convo.find(event)) {
			await stopConvo(event, null, true);
		}
	
		const convo = bp.convo.create(event);
		try {
			activityHandlers[activityType](convo, event, activityName);
		} catch (err) {
			console.error(err);
		}
	}

	async function seeEvents(event) {
		const avaliableEvents = await andybot.avaliableEvents(event.user.id);
		const payload = {
			template_type: "generic",
			elements: _.map(avaliableEvents.slice(0,10), (ele) => {
				const imageName = _.find(activities['schedule'], (scheduleObj) => {
					return scheduleObj.id === ele.eventId
				}).image;
				return {
					title: ele.title,
					subtitle: ele.subtitle,
					image_url: `${config.staticUrl}img/${imageName}?time=7`,
					buttons: [
						{
							type: "web_url",
							url: ele.link,
							title: "Details"
						}
					]
				}
			})
		}
		 
		bp.messenger.sendTemplate(event.user.id, payload, { typing: 2000 })
	}

	async function stopConvo(event, next, sendNotification){
		const convo = bp.convo.find(event);
		if (convo) {
			convo.stop('aborted');
			if (sendNotification === true) {
				event.reply('#activity_ended');
				const avaliableActivities = await andybot.avaliableActivities(event.user.id);
				event.reply('#activities', { activities: _.shuffle(avaliableActivities).slice(0, 10) })
			}
		} else {
			event.reply('#no_activity');
		}
	}

	async function beginAdventure(event, next) {
		const avaliableActivities = await andybot.avaliableActivities(event.user.id);
		event.reply('#activities', { activities: _.shuffle(avaliableActivities).slice(0, 9) });
	}

	async function handleScan(referral, event) {
		if (utils.isNonNull(referral)) {
			const scanResponse = await andybot.scan.scanCode(event.user.id, referral.ref);

			// 1. Handle stamp unlock
			if (utils.isNonNull(scanResponse) && utils.isNonNull(scanResponse.stamp)){
				if (scanResponse.stamp.error && scanResponse.stamp.error === "DailyLimitReached") {
					event.reply("#daily_scan_limit_reached");
					return;
				} else {
					const stampObj = _.find(activities.stamps, (s) => s.stamp_id === scanResponse.code.ref)
					const image = stampObj.splash_image;
					event.reply("#stamp_unlock", { image, text: "You unlocked a stamp!"});
					return;
				}
			}

			// 2. Handle Possible check in to a museum
			if (scanResponse.scan.type === 'checkin') {
				const avaliableActivities = await andybot.avaliableActivities(event.user.id);
				setTimeout(() => {
					event.reply('#activities', { activities: _.shuffle(avaliableActivities).slice(0, 9) });
				}, 2000);
				return;
			} else if (scanResponse.scan.type === 'activity') {
				const triggeredActivities = scanResponse.scan.trigger;
				const avaliableActivities = _.map(triggeredActivities, (activity_id) => _.find(activities.manifest, (o) => o.activity === activity_id));

				if (utils.isNonNull(scanResponse.scan.followup)){
					setTimeout(() => {
						event.reply("#text",  { text: scanResponse.scan.followup });
					}, 500);
				}

				setTimeout(() => {
					event.reply("#activities",  { activities: avaliableActivities });
				}, 2000);
				
				return;

			} else if (scanResponse.scan.type === 'scavengerhunt') {

				if (utils.isNonNull(scanResponse.scavengerhunt)){
					if (scanResponse.scavengerhunt.clueNumber === 0) {
						event.reply("scavengerhunt-firstclue", scanResponse.scavengerhunt);
						return
					}

					if (scanResponse.scavengerhunt.lastClue === true) {
						event.reply("scavengerhunt-lastclue", scanResponse.scavengerhunt);
						return
					}

					if (utils.isNonNull(scanResponse.scavengerhunt.followup)) {
						event.reply("scavengerhunt-followup-clue", scanResponse.scavengerhunt);
						return
					} else {
						event.reply("scavengerhunt-clue", scanResponse.scavengerhunt);
						return;	
					}
				}
			}
		}
	}

	async function fallBackHandler(event, next) {
		if (event.type === 'postback' || event.type === 'message' || event.type === 'referral') {
			let referral;
			if (utils.isNonNull(event.raw.referral)) {
				referral = event.raw.referral;
			} else if (utils.isNonNull(event.raw.postback) && utils.isNonNull(event.raw.postback.referral)) {
				referral = event.raw.postback.referral;
			}

			await handleScan(referral, event)
		}
	}

	bp.fallbackHandler = fallBackHandler;

	bp.hear(/GET_STARTED/i, getStarted);

	bp.hear(/START_ACTIVITY:/, startActivity);

	bp.hear(/SEE_EVENTS/, seeEvents);

	bp.hear(/SCAVENGER_HUNT_HINT:/, sendScavengerHuntHint);

	bp.hear(/HOW_TO_PLAY/, howToPlay);

	bp.hear(/BEGIN_ADVENTURE/, beginAdventure);

	bp.hear(/STOP_CONVO/, (event, next) => { stopConvo(event, next, true) });
	
	bp.hear(/PRIZES/, prizes);

	eventHandlers.fallBackHandler = fallBackHandler;
	eventHandlers.getStarted = getStarted;
	eventHandlers.howToPlay = howToPlay;
	eventHandlers.stopConvo = stopConvo;
	eventHandlers.startActivity = startActivity;
	eventHandlers.sendScavengerHuntHint = sendScavengerHuntHint;
	eventHandlers.prizes = prizes;
};


module.exports.eventHandlers = eventHandlers;