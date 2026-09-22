import { APPNAME, MINEXCALIDRAWVERSION } from "src/constants/constants";

//Magyar
export default {
  //settings
  JSON_MALFORMED: `Malformed JSON`,
  JSON_MISSING_KEYS: `JSON must have these 4 keys: "parents", "children", "friends", "nextFriends"`,
  JSON_VALUES_NOT_STRING_ARRAYS: `Key values must be a non-empty array of strings. e.g. "parents": ["Parent", "Parents", "up"]`,
  EXCALIBRAIN_FILE_NAME: "Filepath of Excalibrain drawing",
  EXCALIBRAIN_FILE_DESC: "⚠ This file will be overwritten by the plugin. If you stop the script and make changes to the graph, you " +
    "should rename the file so your edits are preserved, because the next time you initiate ExcaliBrain your edits will be overwritten by " +
    "the automatically generated ExcaliBrain graph.",
  INDEX_REFRESH_FREQ_NAME: "Index refresh frequency (seconds)",
  INDEX_REFRESH_FREQ_DESC: "ExcaliBrain will update its index whenever you switch work panes, in case a file has changed in your Vault since the last index update. <br>" +
                           "This setting is thus only relevant when you are typing in a markdown editor (not switching files or panes) and you still want ExcaliBrain to update it's graph as you type. " +
                           "Because frequent background index updates can be resource intensive you have an option to increase the time interval for the index-updates which in turn will reduce the " +
                           "overhead on your system.",
  HIERARCHY_HEAD: "Ontology",
  HIERARCHY_DESC: "Ontology, the heart of Excalibrain. It is the context of our knowledge graph and refers to a system for organizing and defining the relationships between different nodes in the graph. " +
    "It allows us to add semantic meaning to connections by associating them with specific Dataview fields, such as 'author' or 'chapter,' which influence the way nodes are positioned relative to each other on the graph. " +
    "This approach enables a more structured and meaningful representation of information, making it easier to understand and explore the interconnectedness of concepts within the markdown documents in your Vault.<br><br>" +
    "Enter the field names separated by comma (,) that you will use to define links in your graph.<br><br>" +
    "You can also add fields to the ontology on the fly from the markdown editor by typing the new field (e.g.: 'Consits of::') " +
    "and then calling one of the command palette actions to <code>Add dataview field to ontology as ...</code>, or by opening the context menu.",
  INFER_NAME: "Infer all implicit relationships as Friend",
  INFER_DESC: "<b>Toggle On:</b> All implicit links in the document are interpreted as FRIENDS.<br>" + 
    "<b>Toggle Off:</b> The following logic is used:<ul>" +
    "<li>A forward link is inferred as a CHILD</li>" +
    "<li>A backlink is inferred as a PARENT</li>" +
    "<li>If files mutually link to each other, they are FRIENDS</li></ul>",
  REVERSE_NAME: "Reverse infer logic",
  REVERSE_DESC: "<b>Toggle ON:</b> Treat backlinks as children and forward links as parents.<br><b>Toggle OFF:</b> Treat backlinks as parents and forward links as children</b>",
  INVERSE_ARROW_DIRECTION_NAME: "Inverse arrow direction",
  INVERSE_ARROW_DIRECTION_DESC: "<b>Toggle ON:</b> Display arrow heads in the opposite direction of the link direction.<br><b>Toggle OFF:</b> Display arrow heads in the same direction as the link direction</b>",
  HIDDEN_NAME: "Hidden",
  HIDDEN_DESC: "Dataview or YAML fields that are hidden in the graph.",
  PARENTS_NAME: "Parents",
  CHILDREN_NAME: "Children",
  LEFT_FRIENDS_NAME: "Left-Side Friends",
  RIGHT_FRIENDS_NAME: "Right-Side Friends",
  PREVIOUS_NAME: "Previous (Friends)",
  NEXT_NAME: "Next (Friends)",
  EXCLUSIONS_NAME: "Excluded",
  EXCLUSIONS_DESC: "Dataview or YAML fields that are never used for ontology. These fields will not show up in the ontology suggester in the markdown editor, and will not be shown in the unassigned list.",
  UNASSIGNED_NAME: "Unassigned",
  UNASSIGNED_DESC: "Fields in your Vault that are neither excluded nor part of the defined ontology.",
  ONTOLOGY_SUGGESTER_NAME: "Ontology Suggester",
  ONTOLOGY_SUGGESTER_DESC: "Activate ontology suggester in the markdown editor. If enabled then typing the trigger sequence at the beginning of a paragraph "+
    "will activate the suggester listing your ontology fields defined above.",
  ONTOLOGY_SUGGESTER_ALL_NAME: "Character sequence to trigger generic suggester. The Generic suggester will include all the ontology fields regardless of their direction.",
  ONTOLOGY_SUGGESTER_PARENT_NAME: "Character sequence to trigger parent suggester",
  ONTOLOGY_SUGGESTER_CHILD_NAME: "Character sequence to trigger child suggester",
  ONTOLOGY_SUGGESTER_LEFT_FRIEND_NAME: "Character sequence to trigger left-side friend suggester",
  ONTOLOGY_SUGGESTER_RIGHT_FRIEND_NAME: "Character sequence to trigger right-side friend suggester",
  ONTOLOGY_SUGGESTER_PREVIOUS_NAME: "Character sequence to trigger pr<u>e</u>vious (friend) suggester",
  ONTOLOGY_SUGGESTER_NEXT_NAME: "Character sequence to trigger next (friend) suggester",
  MID_SENTENCE_SUGGESTER_TRIGGER_NAME: "Mid-sentence dataview field suggester trigger",
  MID_SENTENCE_SUGGESTER_TRIGGER_DESC: "You may add fields mid-way in sentences following one of these two formats:<br>" +
    "<code>We met at [location:: [[XYZ restaurant]]] with [candidate:: [[John Doe]]]</code><br>" +
    "<code>We met at (location:: [[XYZ restaurant]]) with (candidate:: [[John Doe]])</code><br>" +
    "If you set this trigger to e.g. <code>(</code> then typing <code>(:::</code> anywhere in the sentence will activate the suggester (assuming you are using the default generic suggester trigger commbination of <code>:::</code> - see setting above).<br>" +
    "More info on inline fields: [DataView Help](https://blacksmithgu.github.io/obsidian-dataview/data-annotation/)",
  BOLD_FIELDS_NAME: "Add selected field with BOLD",
  BOLD_FIELDS_DESC: "Add selected field to text with bold typeface, i.e. (**field name**:: ) resulting in (<b>field name</b>:: )",

  DISPLAY_HEAD: "Display",
  COMPACT_VIEW_NAME: "Compact view",
  COMPACT_VIEW_DESC: "Controls the width of the graph by setting the maximum number of columns that are displayed for children and parent nodes.<br><b>Toggle ON:</b>The max number of child columns is 3, and the max number of parent columns is 2<br><b>Toggle OFF:</b>The max number of child columns is 5, max number of parent columns is 3",
  COMPACTING_FACTOR_NAME: "Compacting factor",
  COMPACTING_FACTOR_DESC: "The higher the number the more compact the graph will be. The lower the number the more spread out the graph will be.",
  MINLINKLENGTH_NAME: "Minimum center-friend distance",
  MINLINKLENGTH_DESC: "The minimum distance betweeen the central node and the friend nodes. The higher the number the furhter away the friends will be from the parent, " +
    "leaving more space for the link ontology labels.",
  /*RENDERALIAS_NAME: "Display alias if available",
  RENDERALIAS_DESC: "Displays the page alias instead of the filename if it is specified in the page's front matter.",*/
  NODETITLE_SCRIPT_NAME: 'Dataview expression for rendering node names',
  NODETITLE_SCRIPT_DESC: 'Dataview expression used to render the node title. If you do not need it, leave this field empty.<br>The expression receives the Dataview page as <code>dvPage</code> and the normal ExcaliBrain label as <code>defaultName</code>.<br>Examples:<br><code>default(dvPage.title, defaultName)</code><br><code>lower(defaultName)</code><br><code>dvPage.file.path</code>',
  /*SHOWINFERRED_NAME: "Display inferred relationships",
  SHOWINFERRED_DESC: "<b>Toggle ON</b>: Display both explicitly defined and inferred links. Forward links are children, backlinks are parents, " +
    "if two page mutually referes to one another then relationship is inferred to be a friendship. Explicitly defined relationships always " +
    "take priority.<br><b>Toggle OFF</b>: Display only explicitely defined relationships.",
  SHOWVIRTUAL_NAME: "Display virtual child nodes",
  SHOWVIRTUAL_DESC: "<b>Toggle ON</b>: Display unresolved links.<br><b>Toggle OFF</b>: Do not display unresolved links.",
  SHOWATTACHMENTS_NAME: "Include attachments",
  SHOWATTACHMENTS_DESC: "<b>Toggle ON</b>: Display every type of file on the graph. " +
    "<br><b>Toggle OFF</b>: Display only markdown files.",*/
  
  BEHAVIOR_HEAD: "Behavior",
  EXCLUDE_PATHLIST_NAME: "Filepaths to exclude",
  EXCLUDE_PATHLIST_DESC: "Enter comma-separated list of filepaths to exclude from the index.",

  STYLE_HEAD: "Styling",
  STYLE_DESC: "Styles are applied in sequence.<br><ol><li><b>Base</b> node style</li>" +
    "<li><b>Inferred</b> node style (only applied if the node is inferred)</li><li><b>Virtual</b> node style (only applied if the node is virtual)</li> " +
    "<li><b>Central</b> node style (only applied if the node is in the center)</li><li><b>Sibling</b> node style (only applied if the node is a sibling)</li> " +
    "<li><b>Attachment</b> node style (only applied if the node is an attachment)</li><li><b>Optional</b> tag based style</li></ol>" +
    "All the attributes of the base node style must be specified. " +
    "All other styles may have partial definitions. e.g. You may add a prefix and override the base node-background color in the tag-based style, " + 
    "override the font color in the inferred-node style and set the border stroke style to dotted in the virtual-node style.",
  CANVAS_BGCOLOR: "Canvas color",
  SHOW_FULL_TAG_PATH_NAME: "Display full tag name",
  SHOW_FULL_TAG_PATH_DESC: "<b>Toggle on:</b> will display the full tag e.g. #reading/books/sci-fi</br>" +
    "<b>Toggle off:</b> will display the current section of the tag, e.g. assuming the tag above, the graph will display only #reading, #books, #sci-fi respectively as you navigate the tag hierarchy.",
  SHOW_COUNT_NAME: "Display neighbor count",
  SHOW_COUNT_DESC: "Show the number of children, parents, friends next to the node gate",
  ALLOW_AUTOZOOM_NAME: "Autozoom",
  ALLOW_AUTOZOOM_DESC: "<b>Toggle ON:</b> Allow autozoom<br><b>Toggle OFF:</b> Disable autozoom",
  MAX_AUTOZOOM_NAME: "Maximum autozoom level [%]",
  MAX_AUTOZOOM_DESC: "Maximum zoom level to apply when autozoom is enabled. The higher the number the more zoomed in the graph will be.",
  ALLOW_AUTOFOCUS_ON_SEARCH_NAME: "Autofocus on search",
  ALLOW_AUTOFOCUS_ON_SEARCH_DESC: "<b>Toggle ON:</b> Allow autofocus on Search<br><b>Toggle OFF:</b> Disable autofocus",
  ALWAYS_ON_TOP_NAME: "Popout default 'always on top' behavior",
  ALWAYS_ON_TOP_DESC: "<b>Toggle ON:</b> When opening ExcaliBrain in a popout window, it will open with the new window in 'always on top' mode.<br><b>Toggle OFF:</b> The new window will not be in 'always on top' mode.",
  EMBEDDED_FRAME_WIDTH_NAME: "Embedded frame width",
  EMBEDDED_FRAME_HEIGHT_NAME: "Embedded frame height",
  TAGLIST_NAME: "Formatted tags",
  TAGLIST_DESC: "You can specify special formatting rules for Nodes based on tags. If there are multiple tags present in a note, and 'note type::' is not defined, the page the first matching a specification " +
    "will be used. <br>Tagnames should start with <mark>#</mark> and may be incomplete. i.e. <code>#book</code> will match #books, #book/fiction, etc.<br>" +
    "tAg NaMeS are CaSE sensiTIve<br>" +
    "Enter a comma separated list of tags here, then select from the dropdown list to change the formatting.",
  NOTE_STYLE_TAG_NAME: "Note style tag field",
  NOTE_STYLE_TAG_DESC: "The dataview field to designate the primary tag for styling the page. This tag will be used as the base style. " +
    "If other tags on the page also have defined styles and those style definitions include a prefix character " +
    "those prefixes will be also added to the note title.",
  ALL_STYLE_PREFIXES_NAME: "Display all tags styles",
  ALL_STYLE_PREFIXES_DESC: "Display tag prefixes for all tags included in the note",
  MAX_ITEMCOUNT_DESC: "Maximum node count",
  MAX_ITEMCOUNT_NAME: "Maximum number of nodes to display in a given area of the layout." + 
    "i.e. the maximum number of parents, the maximum number of children, the maximum number of friends, and " +
    "the maximum number of siblings to display. If there are more items, they will be ommitted from the drawing.",
  NODESTYLE_INCLUDE_TOGGLE: "Toggle ON: override base node style for this attribute; OFF: apply base node style for this attribute",
  NODESTYLE_PREFIX_NAME: "Prefix",
  NODESTYLE_PREFIX_DESC: "Prefix character or emoji to display in front of the node's label",
  NODESTYLE_BGCOLOR: "Background color",
  NODESTYLE_BG_FILLSTYLE: "Background fill-style",
  NODESTYLE_TEXTCOLOR: "Text color",
  NODESTYLE_BORDERCOLOR: "Border color",
  NODESTYLE_FONTSIZE: "Font size",
  NODESTYLE_FONTFAMILY: "Font family",
  NODESTYLE_MAXLABELLENGTH_NAME: "Max label length",
  NODESTYLE_MAXLABELLENGTH_DESC: "Maximum number of characters to display from node title. Longer nodes will end with '...'",
  NODESTYLE_ROUGHNESS: "Stroke roughness",
  NODESTYLE_SHARPNESS: "Stroke sharpness",
  NODESTYLE_STROKEWIDTH: "Stroke width",
  NODESTYLE_STROKESTYLE: "Stroke style",
  NODESTYLE_RECTANGLEPADDING: "Padding of the node rectangle",
  NODESTYLE_GATE_RADIUS_NAME: "Gate radius",
  NODESTYLE_GATE_RADIUS_DESC: "The radius of the 3 small circles (alias: gates) serving as connection points for nodes",
  NODESTYLE_GATE_OFFSET_NAME: "Gate offset",
  NODESTYLE_GATE_OFFSET_DESC: "The offset to the left and right of the parent and child gates.",
  NODESTYLE_GATE_COLOR: "Gate border color",
  NODESTYLE_GATE_BGCOLOR_NAME: "Gate background color",
  NODESTYLE_GATE_BGCOLOR_DESC: "The fill color of the gate if it has children",
  NODESTYLE_GATE_FILLSTYLE: "Gate background fill-style",
  NODESTYLE_BASE: "Base node style",
  NODESTYLE_CENTRAL: "Style of central node",
  NODESTYLE_INFERRED: "Style of inferred nodes",
  NODESTYLE_URL: "Style of web page nodes",
  NODESTYLE_VIRTUAL: "Style of virtual nodes",
  NODESTYLE_SIBLING: "Style of sibling nodes",
  NODESTYLE_ATTACHMENT: "Style of attachment nodes",
  NODESTYLE_FOLDER: "Style of folder nodes",
  NODESTYLE_TAG: "Style of tag nodes",
  LINKSTYLE_COLOR: "Color",
  LINKSTYLE_WIDTH: "Width",
  LINKSTYLE_STROKE: "Stroke style",
  LINKSTYLE_ROUGHNESS: "Roughness",
  LINKSTYLE_ARROWSTART: "Start arrow head",
  LINKSTYLE_ARROWEND: "End arrow head",
  LINKSTYLE_SHOWLABEL: "Show label on link",
  LINKSTYLE_FONTSIZE: "Label font size",
  LINKSTYLE_FONTFAMILY: "Label font family",
  LINKSTYLE_BASE: "Base link style",
  LINKSTYLE_INFERRED: "Style of inferred link",
  LINKSTYLE_FOLDER: "Style of folder link",
  LINKSTYLE_TAG: "Style of tag link",
  //main
  DATAVIEW_NOT_FOUND: `Dataview plugin not found. Please install or enable Dataview then try restarting ${APPNAME}.`,
  DATAVIEW_UPGRADE: `Please upgrade Dataview to 0.5.31 or newer. Please update Dataview then try restarting ${APPNAME}.`,
  EXCALIDRAW_NOT_FOUND: `Excalidraw plugin not found. Please install or enable Excalidraw then try restarting ${APPNAME}.`,
  EXCALIDRAW_MINAPP_VERSION: `ExcaliBrain requires Excalidraw ${MINEXCALIDRAWVERSION} or higher. Please upgrade Excalidraw then try restarting ${APPNAME}.`,
  COMMAND_ADD_HIDDEN_FIELD: "Add dataview field to ontology as HIDDEN",
  COMMAND_ADD_PARENT_FIELD: "Add dataview field to ontology as PARENT",
  COMMAND_ADD_CHILD_FIELD: "Add dataview field to ontology as CHILD",
  COMMAND_ADD_LEFT_FRIEND_FIELD: "Add dataview field to ontology as LEFT-SIDE FRIEND",
  COMMAND_ADD_RIGHT_FRIEND_FIELD: "Add dataview field to ontology as RIGHT-SIDE FRIEND",
  COMMAND_ADD_PREVIOUS_FIELD: "Add dataview field to ontology as PREVIOUS",
  COMMAND_ADD_NEXT_FIELD: "Add dataview field to ontology as NEXT",
  COMMAND_ADD_ONTOLOGY_MODAL: "Add dataview field to ontology: Open Ontology Modal",
  COMMAND_START: "ExcaliBrain Normal",
  COMMAND_START_HOVER: "ExcaliBrain Hover-Editor",
  COMMAND_START_POPOUT: "ExcaliBrain Popout Window",
  //COMMAND_SEARCH: "Search",
  COMMAND_STOP: "Stop ExcaliBrain",
  HOVER_EDITOR_ERROR: "I am sorry. Something went wrong. Most likely there was a version update to Hover Editor which I haven't addressed properly in ExcaliBrain. Normally I should get this fixed within few days",
  //ToolsPanel
  OPEN_DRAWING: "Save snapshot for editing",
  SEARCH_IN_VAULT: "Starred items will be listed in empty search.\nSearch for a file, a folder or a tag in your Vault.\nToggle folders and tags on/off to show in the list.",
  SHOW_HIDE_ATTACHMENTS: "Show/Hide attachments",
  SHOW_HIDE_VIRTUAL: "Show/Hide virtual nodes",
  SHOW_HIDE_INFERRED: "Show/Hide inferred relationships",
  SHOW_HIDE_ALIAS: "Show/Hide document alias",
  SHOW_HIDE_SIBLINGS: "Show/Hide siblings",
  SHOW_HIDE_POWERFILTER: "Enable/Disable Power Filter",
  SHOW_HIDE_EMBEDDEDCENTRAL: "Display central node as embedded frame",
  SHOW_HIDE_URLS: "Show/Hide URLs in central notes as graph nodes",
  SHOW_HIDE_FOLDER: "Show/Hide folder nodes",
  SHOW_HIDE_TAG: "Show/Hide tag nodes",
  SHOW_HIDE_PAGES: "Show/Hide page nodes (incl. defined, inferred, virtual and attachments)",
  PIN_LEAF: "Link ExcaliBrain to the most recent active leaf. When linked, ExcaliBrain will only monitor changes of the pinned leaf and open synchronized pages only on the pinned leaf.",
  NAVIGATE_BACK: "Navigate back",
  NAVIGATE_FORWARD: "Navigate forward",
  REFRESH_VIEW: "Refresh",
  //3D view (Scene.renderFloor): compass labels at the ends of the floor's cross
  COMPASS_NORTH: "N",
  COMPASS_SOUTH: "S",
  COMPASS_WEST: "W",
  COMPASS_EAST: "E",
  AUTO_OPEN_DOCUMENT: "Synchronize navigation. When plugs are connected, changes to ExcaliBrain focus will be reflected in the active  Obsidian tab and vice versa.\n\n" +
    "You can link/unlink this button to the '<> Display central node as embedded frame' button in the ExcaliBrain settings.",
  TOGGLE_AUTOOPEN_WHEN_EMBED_TOGGLE_NAME: "Synchronize navigation on Embed toggle",
  TOGGLE_AUTOOPEN_WHEN_EMBED_TOGGLE_DESC: "<b>Toggle ON</b>: When you toggle the <i>'<kbd>&lt;&thinsp;&gt;</kbd> Display central node as embedded frame'</i> button, ExcaliBrain will automatically turn navigation synchronization on<br>" +
    "<b>Toggle OFF</b>: When you toggle the <i>'<kbd>&lt;&thinsp;&gt;</kbd> Display central node as embedded frame'</i> button, ExcaliBrain will not automatically turn navigation synchronization on",

  //AddToOntologyModal
  ADD_TO_ONTOLOGY_MODAL_DESC: "Select the direction of the ontology. If one of the buttons is highlighted, then the field is already part of the ontology in that direction.",

  //Up / Down regions of the ontology (docs/ontology-axis-design.md). Other locales fall back to these.
  UP_NAME: "Up (abstract)",
  UP_DESC: "Fields whose target is more abstract than the note. Drawn north like Parents, with the Up link style unless the field has a style of its own. " +
    "A field listed both here and under Parents is kept here and removed from Parents the next time the settings are loaded.",
  DOWN_NAME: "Down (concrete)",
  DOWN_DESC: "Fields whose target is more concrete than the note. Drawn south like Children, with the Down link style unless the field has a style of its own. " +
    "A field listed both here and under Children is kept here and removed from Children the next time the settings are loaded.",
  LINKSTYLE_UP: "Style of Up (abstract) links",
  LINKSTYLE_DOWN: "Style of Down (concrete) links",
  TOGGLE_3D_VIEW: "Toggle 3D view. Up parents are raised, Down children lowered, everything else stays on the ground. Not saved: ExcaliBrain always starts in 2D.",

  //3D view settings (docs/3d-design.md §6-1): cabinet projection. Other locales fall back to these.
  VIEW3D_HEAD: "3D view",
  VIEW3D_NORTH_SHEAR_X_NAME: "North shear (x)",
  VIEW3D_NORTH_SHEAR_X_DESC: "How far a node shifts right on screen for every unit it lies north of the central node in the 2D layout. 0 keeps north straight up, 0.4 is the cabinet-drawing default.",
  VIEW3D_NORTH_RISE_NAME: "North rise (y)",
  VIEW3D_NORTH_RISE_DESC: "How far a node shifts up on screen for every unit it lies north of the central node. Smaller values flatten the floor.",
  VIEW3D_HEIGHT_SHEAR_X_NAME: "Height shear (x)",
  VIEW3D_HEIGHT_SHEAR_X_DESC: "How far a node shifts east on screen for every pixel it stands above the floor, so what stands on the floor leans the way the floor does. Nodes below the floor (Down) shift west by the same amount. 0 keeps height straight up, which leaves the raised nodes looking too far west.",
  VIEW3D_UP_HEIGHT_FACTOR_NAME: "Up height",
  VIEW3D_UP_HEIGHT_FACTOR_DESC: "How far above the centre the Up parents stand, as a multiple of the node height. Keep it clear of the Parents that stay on the floor.",
  VIEW3D_DOWN_HEIGHT_FACTOR_NAME: "Down depth",
  VIEW3D_DOWN_HEIGHT_FACTOR_DESC: "How far below the centre the Down children hang, as a multiple of the node height.",
  VIEW3D_VERTICAL_GAP_FACTOR_NAME: "Up/Down spacing",
  VIEW3D_VERTICAL_GAP_FACTOR_DESC: "East-west gap between several Ups (or Downs) standing on the vertical axis, as a multiple of the node height.",
  VIEW3D_VERTICAL_COLUMNS_NAME: "Up/Down per row",
  VIEW3D_VERTICAL_COLUMNS_DESC: "How many Ups (or Downs) stand side by side before the next row starts. The extra rows stack further up for Up and further down for Down, instead of the axis growing sideways without end.",
  VIEW3D_ROW_LIFT_FACTOR_NAME: "Wrapped row height",
  VIEW3D_ROW_LIFT_FACTOR_DESC: "Height of one wrapped row, as a multiple of the node height. Keep it well under the Up height so a wrapped row does not read as another level of abstraction.",
  VIEW3D_BAND_DISTANCE_FACTOR_NAME: "Band distance",
  VIEW3D_BAND_DISTANCE_FACTOR_DESC: "How far from the centre the Parents and Children that stay on the floor sit, as a multiple of the node height. Larger values keep them clear of the Up and Down nodes.",
  VIEW3D_FLOOR_NORTH_FACTOR_NAME: "Floor depth (back)",
  VIEW3D_FLOOR_NORTH_FACTOR_DESC: "Smallest reach of the floor behind the centre, as a multiple of the node height. Nodes further back widen it.",
  VIEW3D_FLOOR_SOUTH_FACTOR_NAME: "Floor depth (front)",
  VIEW3D_FLOOR_SOUTH_FACTOR_DESC: "Smallest reach of the floor in front of the centre. This is what makes the plane read as ground rather than a tilted sheet of paper.",
  VIEW3D_FLOOR_MARGIN_FACTOR_NAME: "Floor margin",
  VIEW3D_FLOOR_MARGIN_FACTOR_DESC: "Margin left around the feet at the edge of the floor, as a multiple of the node height.",
  VIEW3D_LEVEL_COLOR_NAME: "Level {n} color",
  VIEW3D_LEVEL_COLOR_DESC: "Background of the nodes on each level while the 3D view is on. Level 1 is the lowest level on screen; the colour is the only marker of the level, together with the height.",

  //Jev link typer settings (docs/jev-link-typer-design.md §6). Other locales fall back to these.
  JEV_HEAD: "Jev",
  JEV_DESC: "Jev (TypeSafe) ranks the fields of your ontology for a link and you confirm the winner; it never writes prose and never picks a field that is not in your ontology.<br>" +
    "<b>What leaves your vault</b> on every judgement: the text around the link (see the context size below), the frontmatter of the note and of the linked note, the first few hundred characters of the linked note, and the names and descriptions of your ontology fields. Not the whole note, not other notes, not your vault paths.<br>" +
    "<b>Where the key is kept</b>: this plugin's <code>data.json</code>, in plain text like every other setting. Anything that reads that file — a sync, a backup, a git repository — reads the key with it.",
  JEV_APIKEY_NAME: "API key",
  JEV_APIKEY_DESC: "Your TypeSafe key. While it is empty, Jev registers nothing at all: no command, no button, no suggester and no view.",
  JEV_ENABLED_NAME: "Enable Jev",
  JEV_ENABLED_DESC: "Turns Jev off without deleting the key. Both this and the key are read while the plugin loads, so a change takes effect on the next reload.",
  JEV_SUGGEST_ON_LINK_CLOSE_NAME: "Suggest when a link is closed",
  JEV_SUGGEST_ON_LINK_CLOSE_DESC: "Offer a field as soon as you type the closing ]] of a link. The command and the queue keep working with this off.",
  JEV_CONTEXT_CHARS_NAME: "Context size",
  JEV_CONTEXT_CHARS_DESC: "How many characters on either side of the link are sent as context. More context costs more per judgement.",
  JEV_RELATIONS_HEADING_NAME: "Relations heading",
  JEV_RELATIONS_HEADING_DESC: "Heading of the section a confirmed field:: [[link]] line is appended to. The section is added at the end of the note when it is missing. Write the text only: the # markers are added for you, and emptying this restores the default.",
  JEV_WRITE_MODE_NAME: "Where the field is written",
  JEV_WRITE_MODE_DESC: "A confirmed field goes into the Relations section, which leaves the body untouched and is easy to read in a diff, or into the link in the body itself.",
  JEV_WRITE_MODE_RELATIONS: "Relations section",
  JEV_WRITE_MODE_INLINE: "Inline, in the body",
  JEV_AUTO_CONFIRM_THRESHOLD_NAME: "Bulk auto-confirm threshold",
  JEV_AUTO_CONFIRM_THRESHOLD_DESC: "From this probability up — and only when the field and the direction agree — a bulk run writes the first candidate without asking. Everything below it waits in the queue.",
  JEV_REVIEW_THRESHOLD_NAME: "Review threshold",
  JEV_REVIEW_THRESHOLD_DESC: "An existing field is offered for review when Jev's first candidate differs from it and is at least this probable. A review is never applied on its own.",
  JEV_ENDPOINT_NAME: "Endpoint",
  JEV_ENDPOINT_DESC: "The URL every Jev request goes to. This is the only address this plugin talks to.",
  JEV_MODEL_NAME: "Model",
  JEV_MODEL_DESC: "The Jev model to ask.",
  JEV_RELOAD_NOTICE: "Reload Obsidian for this to take effect: whether Jev is registered at all is decided while the plugin loads.",

  //Jev command (docs/jev-link-typer-design.md §4-1). {field}, {target}, {candidates}, {probability} and {tokens} are filled in by the command.
  JEV_COMMAND_TYPE_LINK: "Jev: type the link at the cursor (confirm the first candidate)",
  JEV_COMMAND_NO_DATAVIEW: "Jev needs Dataview to read the fields of your notes.",
  JEV_COMMAND_NO_INDEX: "This note is not in the index yet. Try again in a moment, or check the excluded paths.",
  JEV_COMMAND_NO_LINK: "Put the cursor on a link that has no field yet.",
  JEV_COMMAND_EXCLUDED: "This note is left out of the graph (excluded paths, or the brain drawing itself), so Jev does not write to it.",
  JEV_COMMAND_BUSY: "Jev is still working on the last link. Wait for its answer.",
  JEV_COMMAND_UNCONFIDENT: "Jev is not sure about [[{target}]]: the field and the direction disagree. Candidates: {candidates}. Nothing was written.",
  JEV_COMMAND_UNKNOWN_FIELD: "Jev answered \"{answer}\" for [[{target}]], which is not a field of your ontology. Nothing was written.",
  JEV_COMMAND_UNCHANGED: "Nothing was written for {field}:: [[{target}]]: the line is already there, or inline writing could not find the link in the body.",
  JEV_COMMAND_WROTE: "Jev wrote {field}:: [[{target}]] ({probability}%, {tokens} tokens).",
  JEV_COMMAND_WROTE_UNLOGGED: "Jev wrote {field}:: [[{target}]] ({probability}%, {tokens} tokens), but could not record it: this line cannot be undone by Jev.",
  JEV_COMMAND_ERROR: "The Jev command failed. See the developer console for details.",

  //Jev typing queue (docs/jev-link-typer-design.md §4-2). Other locales fall back to these.
  JEV_QUEUE_TITLE: "Jev typing queue",
  JEV_QUEUE_OPEN: "Open the typing queue",
  JEV_QUEUE_NO_CENTRE: "Open a note in JevBrain and its untyped links show up here.",
  JEV_QUEUE_NO_CENTRE_SHORT: "No note in the centre",
  JEV_QUEUE_EMPTY: "Every link in this note already has a field.",
  JEV_QUEUE_COUNT: "{n} untyped link(s)",
  JEV_QUEUE_ASKING: "Asking Jev…",
  JEV_QUEUE_FAILED: "Jev did not answer. The developer console has the reason.",
  JEV_QUEUE_RETRY: "Ask again",
  JEV_QUEUE_DEFERRED: "Left for later. Jev does not ask about it again while this panel stays open.",
  JEV_QUEUE_BACK: "Bring back",
  JEV_QUEUE_LATER: "Later",
  JEV_QUEUE_DIRECTION: "Direction {direction}, {probability}",
  JEV_QUEUE_UNCERTAIN: "The field and the direction disagree, so nothing is preselected. Pick one yourself.",
  JEV_QUEUE_CONFIRM: "Confirm {field}",
  JEV_QUEUE_CONFIRM_NONE: "Pick a field first",
  JEV_QUEUE_NO_CHANGE: "Jev left the note alone: that field is already on the link, or the link has moved.",
  JEV_QUEUE_UNDO: "Undo",
  JEV_QUEUE_UNDO_MISSING: "Jev no longer has a record of that line, so it was left as it is.",
  JEV_QUEUE_WRITE_FAILED: "Jev could not finish writing that field. The developer console has the reason, and the note may already hold the line.",
  JEV_QUEUE_UNDO_FAILED: "Jev could not undo that line. The developer console has the reason.",
  JEV_QUEUE_USAGE: "{calls} judgement(s) · {tokens} tokens · about ¥{cost}",
}