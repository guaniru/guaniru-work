import Foundation

struct RewardTask: Identifiable, Codable {
    let id: UUID
    let title: String
    let category: String
    let points: Int
    let estimatedMinutes: Int
    let isCompleted: Bool
    let dueDate: Date?
    let notes: String

    init(
        id: UUID = UUID(),
        title: String,
        category: String,
        points: Int,
        estimatedMinutes: Int,
        isCompleted: Bool = false,
        dueDate: Date? = nil,
        notes: String = ""
    ) {
        self.id = id
        self.title = title
        self.category = category
        self.points = points
        self.estimatedMinutes = estimatedMinutes
        self.isCompleted = isCompleted
        self.dueDate = dueDate
        self.notes = notes
    }
}

final class TaskStore: ObservableObject {
    @Published var tasks: [RewardTask] = [
        RewardTask(
            title: "動画広告を視聴",
            category: "広告",
            points: 30,
            estimatedMinutes: 5,
            dueDate: Calendar.current.date(byAdding: .day, value: 1, to: Date())
        ),
        RewardTask(
            title: "アンケート回答",
            category: "調査",
            points: 80,
            estimatedMinutes: 12,
            isCompleted: true,
            notes: "毎週金曜日までに完了"
        ),
        RewardTask(
            title: "ミッション達成",
            category: "チャレンジ",
            points: 120,
            estimatedMinutes: 15,
            dueDate: Calendar.current.date(byAdding: .day, value: 3, to: Date())
        )
    ]

    var totalPoints: Int {
        tasks.reduce(0) { $0 + ($1.isCompleted ? $1.points : 0) }
    }

    var pendingPoints: Int {
        tasks.reduce(0) { $0 + ($1.isCompleted ? 0 : $1.points) }
    }

    func toggle(_ task: RewardTask) {
        if let index = tasks.firstIndex(where: { $0.id == task.id }) {
            let updated = RewardTask(
                id: task.id,
                title: task.title,
                category: task.category,
                points: task.points,
                estimatedMinutes: task.estimatedMinutes,
                isCompleted: !task.isCompleted,
                dueDate: task.dueDate,
                notes: task.notes
            )
            tasks[index] = updated
        }
    }
}
