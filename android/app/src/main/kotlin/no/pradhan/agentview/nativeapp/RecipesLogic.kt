package no.pradhan.agentview.nativeapp

// web/src/codex/data/recipes.ts: "/" in the Ask bar lists canned questions that fill the field.
class Recipe(val id: String, val title: String, val text: String)

val DEFAULT_RECIPES = listOf(
    Recipe("week", "Summarize this week's meetings", "Summarize this week's meetings: key points, decisions and follow-ups."),
    Recipe("committed", "What did I commit to?", "What did I commit to in recent meetings and chats, and what is still open?"),
    Recipe("decisions", "Open decisions", "List the open decisions, who owns each, and what is blocking them."),
)

fun matchRecipes(recipes: List<Recipe>, input: String): List<Recipe> {
    if (!input.startsWith("/")) return emptyList()
    val words = input.drop(1).trim().lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }
    return recipes.filter { r -> words.all { w -> w in r.title.lowercase() || w in r.text.lowercase() } }
}
