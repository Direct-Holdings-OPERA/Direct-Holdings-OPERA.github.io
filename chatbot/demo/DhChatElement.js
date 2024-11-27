(function(elementName){
const $priv = Symbol("private");
const $domParser = new DOMParser();
const $getXmlAsync = src => fetch(src)
	.then(res => res.text())
	.then(xml => Promise.resolve($domParser.parseFromString(xml, "application/xml")));
function $appendNodeList(nodeList, textList, parent, topdown, children, selector){
	for(let node of children){
		const nodeItem = {
			parent: parent,
			topdown: topdown,
			id: Symbol("node"),
			value: null,
			delay: "WARP"
		};
		if((node.nodeType == Node.TEXT_NODE) || (node.nodeType == Node.CDATA_SECTION_NODE)){
			const prevNode = nodeList.at(-1);
			const prevText = textList.at(-1);
			if((prevNode != null) && (typeof prevNode.value == "string") && (prevNode.parent == nodeItem.parent)){
				prevNode.value += node.data;
				prevText.str += node.data;
			}else{
				nodeItem.leaf = true;
				nodeItem.value = node.data;
				prevText.idx.push(nodeList.length);
				prevText.str += node.data;
				nodeList.push(nodeItem);
			}
		}else if(node.nodeType == Node.ELEMENT_NODE){
			nodeItem.value = {
				tagName: node.tagName.toLowerCase(),
				attributes: Object.fromEntries(Array.from(node.attributes, attr => [attr.name, attr.value])),
				href: (node.hasAttributeNS("web+xmlns://dh-chat/scene", "href") ? node.getAttributeNS("web+xmlns://dh-chat/scene", "href") : null)
			};
			nodeList.push(nodeItem);
			$appendNodeList(nodeList, textList, nodeItem.id, node.matches(selector) ? nodeItem.id: topdown, node.childNodes, selector);
			if(nodeItem.leaf = (nodeList.at(-1) == nodeItem)){
				nodeItem.delay = "EMPTY";
				textList.push({str: "", idx: []});
			}else if(node.matches(selector)){
				nodeItem.leaf = true;
				nodeItem.delay = "TOPDOWN";
			}
		}
	}
}
function $segments(textContent, segmenter){
	const merged = [];
	const segments = segmenter.segment(textContent);
	let lastSegment = null;
	for(let item of segments){
		const {segment, isWordLike} = item;
		if(isWordLike){
			lastSegment = null;
			merged.push({segment, isWordLike});
		}else if(lastSegment == null){
			lastSegment = {segment, isWordLike};
			merged.push(lastSegment);
		}else{
			lastSegment.segment += segment;
		}
	}
	return merged;
}
const $scene = (scene, selector, segmenter) => {
	const items = Array.from(scene.querySelectorAll('template'), template => {
		const documentFragment = template.content;
		const type = (template.hasAttributeNS("web+xmlns://dh-chat/scene", "type")) ? template.getAttributeNS("web+xmlns://dh-chat/scene", "type") : null;
		const nodeItem = {id: Symbol("node"), parent: null, topdown: null, value: null, delay: "TOPDOWN", leaf: true};
		const nodeList = [nodeItem];
		const textList = [{str: "", idx: []}];
		$appendNodeList(nodeList, textList, nodeItem.id, nodeItem.id, documentFragment.childNodes, selector);
		for(let i = textList.length - 1; i >= 0; i--){
			const textItem = textList[i];
			if(textItem.idx.length <= 0){
				continue;
			}
			const segments = $segments(textItem.str, segmenter).map(item => [item.segment.length, item.isWordLike]);
			let p = 0;
			let textIdx = textItem.idx[p];
			const n = textItem.idx.length;
			let nodeItem = nodeList[textIdx];
			let textLen = nodeItem.value.length;
			let join = null;
			nodeItem.tokens = [];
			for(let item of segments){
				let [len, isWordLike] = item;
				join = null;
				while(len > 0){
					if(join != null){
						nodeItem.join = join;
					}
					if(textLen > len){
						nodeItem.tokens.push({len, isWordLike});
						textLen -= len;
						len = 0;
					}else if(textLen < len){
						nodeItem.tokens.push({textLen, isWordLike});
						len -= textLen;
						if(join == null){
							join = nodeItem.id;
						}
						p++;
						textIdx = textItem.idx[p];
						nodeItem = nodeList[textIdx];
						textLen = nodeItem.value.length;
						nodeItem.tokens = [];
					}else{
						nodeItem.tokens.push({len, isWordLike});
						p++;
						if(p < n){
							textIdx = textItem.idx[p];
							nodeItem = nodeList[textIdx];
							textLen = nodeItem.value.length;
							nodeItem.tokens = [];
						}
						len = 0;
					}
				}
			}
			for(let j = n - 1; j >= 0; j--){
				let textIdx = textItem.idx[j];
				const nodeItem = nodeList[textIdx];
				let first = true;
				let str = nodeItem.value;
				for(let token of nodeItem.tokens){
					const val = str.slice(0, token.len);
					str = str.slice(token.len);
					if(first){
						nodeItem.delay = token.isWordLike ? "TEXT" : "EMPTY";
						nodeItem.value = val;
						first = false;
						continue;
					}
					textIdx++;
					const append = {
						id: Symbol("node"),
						parent: nodeItem.parent,
						topdown: nodeItem.topdown,
						leaf: true,
						value: val,
						delay: (token.isWordLike ? "TEXT" : "EMPTY")
					};
					nodeList.splice(textIdx, 0, append);
				}
				delete nodeItem.tokens;
			}
		}
		
		const start = nodeItem.id;
		const warpMap = {};
		const leafMap = {};
		const nodeMap = {};
		const joinMap = {};
		for(let i = nodeList.length - 1; i > 0; i--){
			const nodeItem = nodeList[i];
			if(nodeItem.parent in warpMap){
				warpMap[nodeItem.parent].first = nodeItem.id;
				nodeItem.edge = false;
			}else{
				warpMap[nodeItem.parent] = {
					first: nodeItem.id,
					last: nodeItem.id
				};
				nodeItem.edge = true;
			}
			if(nodeItem.leaf){
				if(!(nodeItem.topdown in leafMap)){
					leafMap[nodeItem.topdown] = [];
				}
				leafMap[nodeItem.topdown].push(nodeItem.id);
			}
			nodeMap[nodeItem.id] = {
				parent: nodeItem.parent,
				value: nodeItem.value,
				delay: nodeItem.delay,
				edge: nodeItem.edge,
				join: (nodeItem.id in joinMap) ? joinMap[nodeItem.id] : null
			};
			if(nodeItem.delay == "TOPDOWN"){
				delete warpMap[nodeItem.id];
			}
			if("join" in nodeItem){
				if(!(nodeItem.join in joinMap)){
					joinMap[nodeItem.join] = [];
				}
				joinMap[nodeItem.join].push(nodeItem.id);
			}
		}
		
		return {start, warpMap, leafMap, nodeMap, type};
	});
	return items;
};
const $parseChat = doc => {
	const locales = doc.documentElement.hasAttribute("locales") ? doc.documentElement.getAttribute("locales") : "ja-JP";
	const selector = doc.documentElement.hasAttribute("selector") ? doc.documentElement.getAttribute("selector") : ":root";
	const segmenter = new Intl.Segmenter(locales, {granularity: "word"});
	const chapters = Array.from(doc.documentElement.childNodes, chapter => {
		if((chapter.nodeType != Node.ELEMENT_NODE) || (chapter.tagName != "Chapter")){
			return null;
		}
		const scenes = Array.from(chapter.childNodes, scene => {
			if((scene.nodeType != Node.ELEMENT_NODE) || (scene.tagName != "Scene")){
				return null;
			}
			return [scene.hasAttribute("id") ? scene.getAttribute("id") : null, $scene(scene, selector, segmenter)];
		}).filter(chapter => chapter != null);
		return [chapter.hasAttribute("id") ? chapter.getAttribute("id") : null, scenes];
	}).filter(chapter => chapter != null);
	const alias = {};
	return {
		chapters: chapters.map((chapterEntry, i) => {
			const [chapterId, chapter] = chapterEntry;
			if(chapterId != null){
				alias[chapterId] = `scene(${i})`;
			}
			return chapter.map((sceneEntry, j) => {
				const [sceneId, scene] = sceneEntry;
				if(sceneId != null){
					alias[sceneId] = `scene(${i},${j})`;
				}
				return scene;
			});
		}),
		alias: alias
	};
};
const $parseLayout = doc => {
	const res = {};
	const content = Symbol("content");
	const types = Object.fromEntries(
		Array.from(doc.documentElement.childNodes, type => {
			if(type.nodeType != Node.ELEMENT_NODE){
				return null;
			}
			const template = type.querySelector("template");
			if(template == null){
				return null;
			}
			if(type.tagName == "Content"){
				return [content, template];
			}
			if((type.tagName != "Type") || (!(type.hasAttribute("name")))){
				return null;
			}
			return [type.getAttribute("name"), template];
		}).filter(chapter => chapter != null)
	);
	for(let name in types){
		types[name] = document.importNode(types[name].content, true);
	}
	if(content in types){
		res.content = document.importNode(types[content].content, true);
		delete types[content];
	}
	res.types = types;
	return res;
};
function* $warp(rendered, id, options){
	const {warpMap, nodeMap} = options;
	const range = document.createRange();
	if(!(id in nodeMap)){
		return;
	}
	const warp = nodeMap[id];
	const node = document.createElement(warp.value.tagName);
	for(let attr of Object.entries(warp.value.attributes)){
		node.setAttribute(...attr);
	}
	if(warp.value.href != null){
		let root = null;
		for(root = rendered[warpMap[id].first]; root.parentNode != null; root = root.parentNode);
		const href = root.host[$priv].location;
		const shref = warp.value.href;
		node.addEventListener("click", e => {
			root.host.resolveLink(href, shref);
		});
	}
	rendered[id] = node;
	yield [node, "WARP"];
	range.setStartBefore(rendered[warpMap[id].first]);
	range.insertNode(node);
	range.setStartBefore(rendered[warpMap[id].first]);
	range.setEndAfter(rendered[warpMap[id].last]);
	node.appendChild(range.extractContents());
	if(warp.edge){
		yield* $warp(rendered, warp.parent, options);
	}
}
function* $render(rendered, target, options){
	const {warpMap, leafMap, nodeMap} = options;
	const leafList = leafMap[target];
	for(let i = leafList.length - 1; i >= 0; i--){
		let node = null;
		const id = leafList[i];
		const leaf = nodeMap[id];
		if(typeof leaf.value == "string"){
			node = document.createTextNode(leaf.value);
			rendered[id] = node;
			if(leaf.join != null){
				const tempNode = document.createDocumentFragment();
				tempNode.appendChild(node);
				for(let j = leaf.join.length - 1; j >= 0; j--){
					const jid = leaf.join[j];
					const jleaf = nodeMap[jid];
					const jnode = document.createTextNode(jleaf.value);
					rendered[jid] = jnode;
					tempNode.appendChild(jnode);
				}
				node = tempNode;
			}
		}else{
			node = document.createElement(leaf.value.tagName);
			for(let attr of Object.entries(leaf.value.attributes)){
				node.setAttribute(...attr);
			}
			if(leaf.value.href != null){
				let root = null;
				for(root = rendered[target]; root.parentNode != null; root = root.parentNode);
				const href = root.host[$priv].location;
				const shref = leaf.value.href;
				node.addEventListener("click", e => {
					root.host.resolveLink(href, shref);
				});
			}
			rendered[id] = node;
		}
		yield [node, leaf.delay];
		rendered[target].appendChild(node);
		if(leaf.delay == "TOPDOWN"){
			yield* $render(rendered, id, options);
		}
		if(leaf.edge && (leaf.parent in warpMap)){
			yield* $warp(rendered, leaf.parent, options);
		}
		if(leaf.join != null){
			for(let j = leaf.join.length - 1; j >= 0; j--){
				const jid = leaf.join[j];
				const jleaf = nodeMap[jid];
				if(jleaf.edge && (jleaf.parent in warpMap)){
					yield* $warp(rendered, jleaf.parent, options);
				}
			}
		}
	}
};
const $renderAsync = async (target, options, delayCallback) => {
	const rendered = {
		[options.start]: target
	};
	const render = $render(rendered, options.start, options);
	for(let entry of render){
		const [node, delay] = entry;
		const v = delayCallback(node, delay);
		if(v > 0){
			await new Promise((resolve, reject) => {
				setTimeout(resolve, v);
			});
		}
	}
	return null;
};
const $renderSceneAsync = async (root, layout, optionList) => {
	for(let options of optionList){
		if(!(options.type in layout)){
			continue;
		}
		const node = layout[options.type].node.cloneNode(true);
		const nodeIterator = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT, node => {
			if(
				node.hasAttributeNS("web+xmlns://dh-chat/view", "types") &&
				node.getAttributeNS("web+xmlns://dh-chat/view", "types").trim().split(/\s+/).includes(options.type)
			){
				return NodeFilter.FILTER_ACCEPT;
			}
			return NodeFilter.FILTER_REJECT;
		});
		const target = nodeIterator.nextNode();
		if(target == null){
			continue;
		}
		const output = target.hasAttributeNS("web+xmlns://dh-chat/view", "output") ? target.getAttributeNS("web+xmlns://dh-chat/view", "output") : "append";
		if(output == "replace"){
			target.innerHTML = "";
		}
		const nodeIterator2 = document.createNodeIterator(node, NodeFilter.SHOW_ELEMENT, node => {
			if(node.hasAttributeNS("web+xmlns://dh-chat/view", "slot")){
				return NodeFilter.FILTER_ACCEPT;
			}
			return NodeFilter.FILTER_REJECT;
		});
		const view = nodeIterator2.nextNode();
		target.appendChild(node);
		if(view != null){
			await $renderAsync(view, options, () => 100);
		}
	}
	return null;
};
class DhChatElement extends HTMLElement{
	static observedAttributes = ["src", "layout"];
	constructor(){
		super();
		const priv = this[$priv] = Object.assign({
			root: this.attachShadow({mode: "closed"}),
			caches: {},
			layout: null,
			location: null,
			history: []
		}, Promise.withResolvers());
	}
	attributeChangedCallback(name, oldValue, newValue){
		if(name == "src"){
			this.location = newValue;
		}else if(name == "layout"){
			const priv = this[$priv];
			$getXmlAsync(newValue).then(doc => {
				const layout = $parseLayout(doc);
				priv.root.innerHTML = "";
				priv.root.appendChild(layout.content);
				priv.types = layout.types;
				priv.layout = {};
				for(let name in layout.types){
					priv.layout[name] = {
						node: layout.types[name]
					};
				}
				priv.resolve(null);
			});
		}
	}
	set location(href){
		const priv = this[$priv];
		const src = new URL(href, location.href);
		const request = `${src.origin}${src.pathname}${src.search}`;
		if(request in priv.caches){
			priv.location = src.href;
			priv.promise.then(() => { this.redoScene(); });
		}else{
			$getXmlAsync(request).then(doc => {
				priv.caches[request] = $parseChat(doc);
				priv.location = src.href;
				priv.promise.then(() => { this.redoScene(); });
			});
		}
	}
	resolveLink(base, href){
		if(href == "#nextScene()"){
			this.nextScene(base);
			return;
		}
		if(href == "#redoScene()"){
			this.redoScene(base);
			return;
		}
		if(href == "#prevScene()"){
			this.prevScene(base);
			return;
		}
		if(href == "#nextChapter()"){
			this.nextChapter(base);
			return;
		}
		if(href == "#currentChapter()"){
			this.currentChapter(base);
			return;
		}
		if(href == "#prevChapter()"){
			this.prevChapter(base);
			return;
		}
		const src = new URL(href, base);
		this.location = src.href;
		
	}
	getAddr(location = null){
		const priv = this[$priv];
		const src = new URL(location == null ? this[$priv].location : location);
		const request = `${src.origin}${src.pathname}${src.search}`;
		const cache = priv.caches[request]
		const hash = src.hash.replace(/^#/, "");
		const matches = ((hash in cache.alias) ? cache.alias[hash] : hash).match(/scene\((\d+)(?:,(\d+))?\)/);
		const addr = (matches == null) ? [0, 0] : [matches[1], matches[2]].map(item => item == null ? 0 : Number(item));
		return [request, addr[0], addr[1]];
	}
	nextScene(location = null){
		const priv = this[$priv];
		let [request, chapter, scene] = this.getAddr(location);
		const chapters = priv.caches[request].chapters;
		scene++;
		while(chapter < chapters.length){
			if(scene >= chapters[chapter].length){
				chapter++;
				scene = 0;
				continue;
			}
			priv.location = `${request}#scene(${chapter},${scene})`;
			$renderSceneAsync(priv.root, priv.layout, chapters[chapter][scene], priv.location);
			break;
		}
	}
	redoScene(location = null){
		const priv = this[$priv];
		let [request, chapter, scene] = this.getAddr(location);
		const chapters = priv.caches[request].chapters;
		while(chapter < chapters.length){
			if(scene >= chapters[chapter].length){
				chapter++;
				scene = 0;
				continue;
			}
			priv.location = `${request}#scene(${chapter},${scene})`;
			$renderSceneAsync(priv.root, priv.layout, chapters[chapter][scene], priv.location);
			break;
		}
	}
	prevScene(location = null){
		const priv = this[$priv];
		let [request, chapter, scene] = this.getAddr(location);
		const chapters = priv.caches[request].chapters;
		scene--;
		while(chapter >= 0){
			if(scene < 0){
				chapter--;
				scene = chapters[chapter].length - 1;
				continue;
			}
			priv.location = `${request}#scene(${chapter},${scene})`;
			$renderSceneAsync(priv.root, priv.layout, chapters[chapter][scene], priv.location);
			break;
		}
	}
	nextChapter(location = null){
		const priv = this[$priv];
		let [request, chapter, scene] = this.getAddr(location);
		const chapters = priv.caches[request].chapters;
		chapter++;
		scene = 0;
		while(chapter < chapters.length){
			if(scene >= chapters[chapter].length){
				chapter++;
				scene = 0;
				continue;
			}
			priv.location = `${request}#scene(${chapter},${scene})`;
			$renderSceneAsync(priv.root, priv.layout, chapters[chapter][scene], priv.location);
			break;
		}
	}
	currentChapter(location = null){
		const priv = this[$priv];
		let [request, chapter, scene] = this.getAddr(location);
		const chapters = priv.caches[request].chapters;
		scene = 0;
		while(chapter < chapters.length){
			if(scene >= chapters[chapter].length){
				chapter++;
				scene = 0;
				continue;
			}
			priv.location = `${request}#scene(${chapter},${scene})`;
			$renderSceneAsync(priv.root, priv.layout, chapters[chapter][scene], priv.location);
			break;
		}
	}
	prevChapter(location = null){
		const priv = this[$priv];
		let [request, chapter, scene] = this.getAddr(location);
		const chapters = priv.caches[request].chapters;
		chapter--;
		scene = 0;
		while(chapter >= 0){
			if(scene < 0){
				chapter--;
				scene = chapters[chapter].length - 1;
				continue;
			}
			priv.location = `${request}#scene(${chapter},${scene})`;
			$renderSceneAsync(priv.root, priv.layout, chapters[chapter][scene], priv.location);
			break;
		}
	}
}
customElements.define(elementName, DhChatElement);
})("dh-chat");