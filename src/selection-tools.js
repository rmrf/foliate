import Gtk from 'gi://Gtk'
import Gio from 'gi://Gio'
import GObject from 'gi://GObject'
import WebKit from 'gi://WebKit'
import Gdk from 'gi://Gdk'
import GLib from 'gi://GLib'
import { gettext as _ } from 'gettext'

import * as utils from './utils.js'
import { WebView } from './webview.js'
import { locales, matchLocales } from './format.js'

const getLanguage = lang => {
    try {
        return new Intl.Locale(lang).language
    } catch (e) {
        console.warn(e)
        return 'en'
    }
}

const getLibreTranslateLanguages = utils.memoize(() => {
    // list of languages supported by LibreTranslate
    const displayName = new Intl.DisplayNames(locales, { type: 'language' })
    const langs = ['en', 'zh', 'zh-cn', 'zh-tw', 'ja', 'ko', 'fr', 'de', 'es', 'it', 'pt', 'ru', 'ar', 'hi', 'th', 'vi', 'tr', 'pl', 'nl', 'sv', 'da', 'no', 'fi', 'cs', 'hu', 'el', 'bg', 'ro', 'hr', 'sk', 'sl', 'et', 'lv', 'lt', 'mt', 'ga', 'cy', 'eu', 'ca', 'gl', 'is', 'mk', 'sq', 'sr', 'hr', 'bs', 'me', 'bg', 'ru', 'uk', 'be', 'kk', 'ky', 'uz', 'tg', 'mn', 'ko', 'ja', 'zh', 'zh-cn', 'zh-tw', 'th', 'vi', 'ms', 'id', 'tl', 'jv', 'su', 'mg', 'ny', 'sn', 'yo', 'ig', 'ha', 'sw', 'zu', 'af', 'xh', 'st', 'nso', 'tn', 'ss', 'ts', 've', 'nr', 'om', 'ti', 'am', 'so', 'rw', 'rn', 'lg', 'ak', 'tw', 'ee', 'ff', 'wo', 'bm', 'ki', 'sw', 'zu', 'xh', 'st', 'nso', 'tn', 'ss', 'ts', 've', 'nr', 'om', 'ti', 'am', 'so', 'rw', 'rn', 'lg', 'ak', 'tw', 'ee', 'ff', 'wo', 'bm', 'ki', 'sw', 'zu', 'xh', 'st', 'nso', 'tn', 'ss', 'ts', 've', 'nr', 'om', 'ti', 'am', 'so', 'rw', 'rn', 'lg', 'ak', 'tw', 'ee', 'ff', 'wo', 'bm', 'ki']
    const defaultLang = matchLocales(langs)[0] ?? 'en'
    return [langs.map(lang => [lang, displayName.of(lang)]), defaultLang]
})

const tools = {
    'dictionary': {
        label: _('Dictionary'),
        uri: 'foliate-selection-tool:///selection-tools/wiktionary.html',
        run: (__, { text, lang }) => ({
            msg: {
                footer: _('From <a id="link">Wiktionary</a>, released under the <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA License</a>.'),
                error: _('No Definitions Found'),
                errorAction: _('Search on Wiktionary'),
            },
            text,
            lang: getLanguage(lang),
        }),
    },
    'wikipedia': {
        label: _('Wikipedia'),
        uri: 'foliate-selection-tool:///selection-tools/wikipedia.html',
        run: (__, { text, lang }) => ({
            msg: {
                footer: _('From <a id="link">Wikipedia</a>, released under the <a href="https://en.wikipedia.org/wiki/Wikipedia:Text_of_the_Creative_Commons_Attribution-ShareAlike_4.0_International_License">CC BY-SA License</a>.'),
                error: _('No Definitions Found'),
                errorAction: _('Search on Wikipedia'),
            },
            text,
            lang: getLanguage(lang),
        }),
    },
    'translate': {
        label: _('Translate'),
        uri: 'foliate-selection-tool:///selection-tools/translate.html',
        run: (popover, { text }) => {
            const [langs, defaultLang] = getLibreTranslateLanguages()
            return {
                msg: {
                    footer: _('Translation by LibreTranslate'),
                    error: _('Cannot retrieve translation'),
                    search: _('Search…'),
                    langs,
                },
                text,
                lang: popover.translate_target_language || defaultLang,
                libretranslateUrl: popover.libretranslate_url,
            }
        },
    },
}

const SelectionToolPopover = GObject.registerClass({
    GTypeName: 'FoliateSelectionToolPopover',
    Properties: utils.makeParams({
        'translate-target-language': 'string',
        'libretranslate-url': 'string',
    }),
}, class extends Gtk.Popover {
    #webView = utils.connect(new WebView({
        settings: new WebKit.Settings({
            enable_write_console_messages_to_stdout: true,
            enable_back_forward_navigation_gestures: false,
            enable_hyperlink_auditing: false,
            enable_html5_database: false,
            enable_html5_local_storage: false,
        }),
    }), {
        'decide-policy': (_, decision, type) => {
            switch (type) {
                case WebKit.PolicyDecisionType.NAVIGATION_ACTION:
                case WebKit.PolicyDecisionType.NEW_WINDOW_ACTION: {
                    const { uri } = decision.navigation_action.get_request()
                    if (!uri.startsWith('foliate-selection-tool:')) {
                        decision.ignore()
                        new Gtk.UriLauncher({ uri }).launch(this.root, null, null)
                        return true
                    }
                }
            }
        },
    })
    constructor(params) {
        super(params)
        utils.bindSettings('viewer', this, ['translate-target-language', 'libretranslate-url'])

        // Support environment variable override for libretranslate URL
        const envUrl = GLib.getenv('FOLIATE_LIBRETRANSLATE_URL')
        if (envUrl && !this.libretranslate_url) {
            this.libretranslate_url = envUrl
        }

        Object.assign(this, {
            width_request: 300,
            height_request: 300,
        })
        this.child = this.#webView
        this.#webView.set_background_color(new Gdk.RGBA())
        this.#webView.registerHandler('settings', payload => {
            if (payload.key === 'translate-target-language')
                this.translate_target_language = payload.value
            else if (payload.key === 'libretranslate-url')
                this.libretranslate_url = payload.value
        })
    }
    loadTool(tool, init) {
        this.#webView.loadURI(tool.uri)
            .then(() => this.#webView.opacity = 1)
            .then(() => this.#webView.exec('init', init))
            .catch(e => console.error(e))
    }
})

const getSelectionToolPopover = utils.memoize(() => new SelectionToolPopover())

export const SelectionPopover = GObject.registerClass({
    GTypeName: 'FoliateSelectionPopover',
    Template: pkg.moduleuri('ui/selection-popover.ui'),
    Signals: {
        'show-popover': { param_types: [Gtk.Popover.$gtype] },
        'run-tool': { return_type: GObject.TYPE_JSOBJECT },
    },
}, class extends Gtk.PopoverMenu {
    constructor(params) {
        super(params)
        const model = this.menu_model
        const section = new Gio.Menu()
        model.insert_section(1, null, section)

        const group = new Gio.SimpleActionGroup()
        this.insert_action_group('selection-tools', group)

        let translateAction
        for (const [name, tool] of Object.entries(tools)) {
            const action = new Gio.SimpleAction({ name })
            action.connect('activate', () => {
                const popover = getSelectionToolPopover()
                Promise.resolve(tool.run(popover, this.emit('run-tool')))
                    .then(x => popover.loadTool(tool, x))
                    .catch(e => console.error(e))
                this.emit('show-popover', popover)
            })
            if (name === 'translate') translateAction = action
            group.add_action(action)
            section.append(tool.label, `selection-tools.${name}`)
        }

        // Add keyboard event controller for 't' key shortcut
        const keyController = new Gtk.EventControllerKey()
        keyController.connect('key-pressed', (_, keyval, keycode, state) => {
            // Check if 't' key is pressed without modifiers
            if (keyval === Gdk.KEY_t && state === 0) {
                // Close the selection popover first when using keyboard shortcut
                this.popdown()
                // Then activate the translate action
                translateAction.activate(null)
                return true
            }
            return false
        })
        this.add_controller(keyController)
    }
})
